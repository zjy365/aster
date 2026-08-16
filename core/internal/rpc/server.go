package rpc

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/zjy365/aster/core/internal/resources"
	"github.com/zjy365/aster/core/internal/session"
)

const maxRequestBody = 1 << 20

type contextService interface {
	Contexts() ([]session.ContextInfo, error)
}

type Server struct {
	token     string
	contexts  contextService
	resources *resources.Service
	handler   http.Handler
}

func NewServer(token string, contexts contextService, resourceService *resources.Service) (*Server, error) {
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("bootstrap token is required")
	}
	server := &Server{token: token, contexts: contexts, resources: resourceService}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("GET /v1/contexts", server.listContexts)
	mux.HandleFunc("GET /v1/namespaces", server.listNamespaces)
	mux.HandleFunc("GET /v1/discovery", server.listDiscovery)
	mux.HandleFunc("POST /v1/resources/list", server.listResources)
	mux.HandleFunc("POST /v1/resources/get", server.getResource)
	mux.HandleFunc("POST /v1/resources/mutate", server.mutateResource)
	mux.HandleFunc("POST /v1/resources/related", server.relatedResources)
	mux.HandleFunc("POST /v1/resources/search", server.searchResources)
	mux.HandleFunc("POST /v1/pods/logs", server.podLogs)
	mux.HandleFunc("POST /v1/pods/logs/stream", server.streamPodLogs)
	mux.HandleFunc("POST /v1/metrics/pods", server.podMetrics)
	mux.HandleFunc("POST /v1/pods/exec", server.podExec)
	mux.HandleFunc("POST /v1/pods/portforward", server.startPortForward)
	mux.HandleFunc("POST /v1/pods/portforward/stop", server.stopPortForward)
	mux.HandleFunc("POST /v1/resources/watch", server.watchResources)
	server.handler = server.authenticate(mux)
	return server, nil
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+s.token {
			writer.Header().Set("WWW-Authenticate", "Bearer")
			writeError(writer, http.StatusUnauthorized, "unauthorized", errUnauthorized)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

func (s *Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) listContexts(writer http.ResponseWriter, _ *http.Request) {
	contexts, err := s.contexts.Contexts()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "kubeconfig_error", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"contexts": contexts})
}

func (s *Server) listNamespaces(writer http.ResponseWriter, request *http.Request) {
	limit, err := queryLimit(request.URL.Query().Get("limit"))
	if err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
		return
	}
	if limit < 0 || limit > maxListLimit {
		writeError(writer, http.StatusBadRequest, "invalid_request", fmt.Errorf("limit must be between 1 and %d", maxListLimit))
		return
	}
	query := request.URL.Query()
	if err := validateContextID(query.Get("contextId")); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
		return
	}
	if err := checkLength("continueToken", query.Get("continueToken"), maxContinueToken); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
		return
	}
	if err := checkLength("labelSelector", query.Get("labelSelector"), maxSelector); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
		return
	}
	if err := checkLength("fieldSelector", query.Get("fieldSelector"), maxSelector); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
		return
	}
	result, err := s.resources.List(request.Context(), resources.ListRequest{
		ContextID:     query.Get("contextId"),
		GVR:           resources.GVR{Version: "v1", Resource: "namespaces"},
		Limit:         limit,
		ContinueToken: query.Get("continueToken"),
		LabelSelector: query.Get("labelSelector"),
		FieldSelector: query.Get("fieldSelector"),
	})
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) listDiscovery(writer http.ResponseWriter, request *http.Request) {
	contextID := request.URL.Query().Get("contextId")
	if err := validateContextID(contextID); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
		return
	}
	discovered, err := s.resources.Discover(request.Context(), contextID)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, resources.DiscoveryResponse{Resources: discovered})
}

func (s *Server) listResources(writer http.ResponseWriter, request *http.Request) {
	var value resources.ListRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateListRequest(value)) {
		return
	}
	result, err := s.resources.List(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) getResource(writer http.ResponseWriter, request *http.Request) {
	var value resources.GetRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateGetRequest(value)) {
		return
	}
	result, err := s.resources.Get(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) mutateResource(writer http.ResponseWriter, request *http.Request) {
	var value resources.MutationRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateMutationRequest(value)) {
		return
	}
	result, err := s.resources.Mutate(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) relatedResources(writer http.ResponseWriter, request *http.Request) {
	var value resources.GetRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateGetRequest(value)) {
		return
	}
	result, err := s.resources.Related(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) searchResources(writer http.ResponseWriter, request *http.Request) {
	var value resources.SearchRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateSearchRequest(value)) {
		return
	}
	result, err := s.resources.Search(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) streamPodLogs(writer http.ResponseWriter, request *http.Request) {
	var value resources.LogsRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateLogsRequest(value)) {
		return
	}
	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeError(writer, http.StatusInternalServerError, "streaming_unsupported", fmt.Errorf("streaming unsupported"))
		return
	}
	lines, err := s.resources.StreamLogs(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}

	writer.Header().Set("Content-Type", "application/x-ndjson")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(http.StatusOK)
	flusher.Flush()
	encoder := json.NewEncoder(writer)
	for {
		select {
		case <-request.Context().Done():
			// Drain so the producer goroutine exits before the handler returns.
			for range lines {
			}
			return
		case line, open := <-lines:
			if !open {
				return
			}
			if err := encoder.Encode(line); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) startPortForward(writer http.ResponseWriter, request *http.Request) {
	var value resources.PortForwardRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validatePortForwardRequest(value)) {
		return
	}
	result, err := s.resources.StartPortForward(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) stopPortForward(writer http.ResponseWriter, request *http.Request) {
	var value resources.PortForwardStopRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validatePortForwardStopRequest(value)) {
		return
	}
	if err := s.resources.StopPortForward(request.Context(), value.ID); err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) podMetrics(writer http.ResponseWriter, request *http.Request) {
	var value resources.MetricsRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateMetricsRequest(value)) {
		return
	}
	result, err := s.resources.PodMetrics(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) podLogs(writer http.ResponseWriter, request *http.Request) {
	var value resources.LogsRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateLogsRequest(value)) {
		return
	}
	result, err := s.resources.Logs(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) podExec(writer http.ResponseWriter, request *http.Request) {
	var value resources.ExecRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateExecRequest(value)) {
		return
	}
	result, err := s.resources.Exec(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

func (s *Server) watchResources(writer http.ResponseWriter, request *http.Request) {
	var value resources.WatchRequest
	if err := decodeJSON(writer, request, &value); err != nil {
		return
	}
	if rejectInvalid(writer, validateWatchRequest(value)) {
		return
	}
	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeError(writer, http.StatusInternalServerError, "streaming_unsupported", fmt.Errorf("streaming unsupported"))
		return
	}
	events, err := s.resources.Watch(request.Context(), value)
	if err != nil {
		writeServiceError(writer, err)
		return
	}

	writer.Header().Set("Content-Type", "application/x-ndjson")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(http.StatusOK)
	flusher.Flush()
	encoder := json.NewEncoder(writer)
	for {
		select {
		case <-request.Context().Done():
			// Wait for the resource forwarder to run its Stop/close defers before
			// returning. This makes cancellation a lifecycle guarantee rather
			// than leaving watcher cleanup racing the completed HTTP request.
			for range events {
			}
			return
		case event, open := <-events:
			if !open {
				return
			}
			if err := encoder.Encode(event); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, target any) error {
	reader := http.MaxBytesReader(writer, request.Body, maxRequestBody)
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", fmt.Errorf("decode request: %w", err))
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			err = fmt.Errorf("request body must contain one JSON object")
		}
		writeError(writer, http.StatusBadRequest, "invalid_request", err)
		return err
	}
	return nil
}

func queryLimit(value string) (int64, error) {
	if value == "" {
		return 0, nil
	}
	limit, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid limit")
	}
	return limit, nil
}
