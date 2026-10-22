package rpc

import (
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnknownAuthorityErrorOffersConfigurationRecovery(t *testing.T) {
	err := fmt.Errorf("list statefulsets: %w", x509.UnknownAuthorityError{Cert: &x509.Certificate{}})
	response := httptest.NewRecorder()
	writeServiceError(response, err)
	var result errorResponse
	if decodeErr := json.Unmarshal(response.Body.Bytes(), &result); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if response.Code != http.StatusBadGateway || result.Error.Code != "kubernetes_error" {
		t.Fatalf("response = %d %+v", response.Code, result)
	}
	for _, text := range []string{err.Error(), "refresh contexts", "quit and reopen Aster", "verify the kubeconfig's CA"} {
		if !strings.Contains(result.Error.Message, text) {
			t.Errorf("message %q does not contain %q", result.Error.Message, text)
		}
	}
}

func TestOtherErrorsKeepTheirMessage(t *testing.T) {
	response := httptest.NewRecorder()
	err := errors.New("connection refused")
	writeServiceError(response, err)
	var result errorResponse
	if decodeErr := json.Unmarshal(response.Body.Bytes(), &result); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if result.Error.Message != err.Error() {
		t.Fatalf("message = %q, want %q", result.Error.Message, err.Error())
	}
}
