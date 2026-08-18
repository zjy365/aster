// SPDX-License-Identifier: Apache-2.0
package resources

import (
	"bufio"
	"context"
	"io"
	"strings"
)

// Streaming pod logs. The sidecar owns the long-lived connection; the
// renderer consumes ndjson lines through Electron main. Cancellation comes
// from the request context, matching the watch lifecycle.

type LogLine struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	Message string `json:"message,omitempty"`
	// Pod tags lines in workload fan-in streams; empty for single-pod streams.
	Pod string `json:"pod,omitempty"`
}

type LogsFollowProvider interface {
	PodLogsFollow(ctx context.Context, contextID, namespace, name, container string, tailLines int64, previous, timestamps bool) (io.ReadCloser, error)
}

const followMaxLineLength = 8 << 10
const followDefaultTail = 200

func (s *Service) StreamLogs(ctx context.Context, request LogsRequest) (<-chan LogLine, error) {
	if request.ContextID == "" || request.Namespace == "" || request.Name == "" {
		return nil, invalid("contextId, namespace and name are required")
	}
	provider, ok := s.clients.(LogsFollowProvider)
	if !ok {
		return nil, invalid("logs follow provider is unavailable")
	}
	tail := request.TailLines
	if tail <= 0 || tail > 100_000 {
		tail = followDefaultTail
	}
	reader, err := provider.PodLogsFollow(ctx, request.ContextID, request.Namespace, request.Name, request.Container, tail, request.Previous, request.Timestamps)
	if err != nil {
		return nil, err
	}

	lines := make(chan LogLine, 64)
	go func() {
		defer close(lines)
		defer reader.Close()
		scanLogLines(ctx, reader, "", lines)
	}()
	return lines, nil
}

// scanLogLines forwards a log stream line by line until it ends or the
// context is cancelled. Lines longer than the cap are truncated; a read
// failure surfaces as a terminal error line.
func scanLogLines(ctx context.Context, reader io.Reader, pod string, lines chan<- LogLine) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	for scanner.Scan() {
		text := scanner.Text()
		if len(text) > followMaxLineLength {
			text = strings.TrimSpace(text[:followMaxLineLength]) + "…"
		}
		select {
		case lines <- LogLine{Type: "line", Text: text, Pod: pod}:
		case <-ctx.Done():
			return
		}
	}
	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		select {
		case lines <- LogLine{Type: "error", Message: err.Error(), Pod: pod}:
		case <-ctx.Done():
		}
	}
}
