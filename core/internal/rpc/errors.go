package rpc

import (
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/zjy365/aster/core/internal/helm"
	"github.com/zjy365/aster/core/internal/resources"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(writer http.ResponseWriter, status int, code string, err error) {
	message := err.Error()
	var unknownCA x509.UnknownAuthorityError
	if errors.As(err, &unknownCA) {
		message += "\nIf you updated kubeconfig or CA certificates, refresh contexts on the cluster selection screen. If this still fails, fully quit and reopen Aster to reload all connections. If the error persists, verify the kubeconfig's CA with your cluster administrator."
	}
	writeJSON(writer, status, errorResponse{Error: errorBody{Code: code, Message: message}})
}

func writeServiceError(writer http.ResponseWriter, err error) {
	var validationError *resources.ValidationError
	var helmValidationError *helm.ValidationError
	var helmNotFoundError *helm.NotFoundError
	switch {
	case errors.As(err, &validationError), errors.As(err, &helmValidationError):
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
	case errors.As(err, &helmNotFoundError):
		writeError(writer, http.StatusNotFound, "not_found", err)
	case apierrors.IsNotFound(err):
		writeError(writer, http.StatusNotFound, "not_found", err)
	case apierrors.IsForbidden(err):
		writeError(writer, http.StatusForbidden, "forbidden", err)
	case apierrors.IsUnauthorized(err):
		writeError(writer, http.StatusUnauthorized, "unauthorized", err)
	case apierrors.IsBadRequest(err) || apierrors.IsInvalid(err):
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
	default:
		writeError(writer, http.StatusBadGateway, "kubernetes_error", err)
	}
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

var errUnauthorized = errors.New("missing or invalid bearer token")
