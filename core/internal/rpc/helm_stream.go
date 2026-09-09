// SPDX-License-Identifier: Apache-2.0
package rpc

import (
	"encoding/json"
	"github.com/zjy365/aster/core/internal/helm"
	"net/http"
)

func (s *Server) streamHelmReleases(writer http.ResponseWriter, request *http.Request) {
	var value helm.ListRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateHelmListRequest(value)) {
		return
	}
	writer.Header().Set("Content-Type", "application/x-ndjson")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	controller := http.NewResponseController(writer)
	if err := controller.Flush(); err != nil {
		return
	}
	encoder := json.NewEncoder(writer)
	emit := func(event helm.ListEvent) error {
		if err := request.Context().Err(); err != nil {
			return err
		}
		if err := encoder.Encode(event); err != nil {
			return err
		}
		return controller.Flush()
	}
	if err := s.helm.StreamList(request.Context(), value, emit); err != nil && request.Context().Err() == nil {
		_ = emit(helm.ListEvent{Kind: "error", Message: err.Error()})
	}
}

func (s *Server) closeHelmList(writer http.ResponseWriter, request *http.Request) {
	var value helm.ListRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateHelmListRequest(value)) {
		return
	}
	s.helm.CloseList(value)
	writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
}
