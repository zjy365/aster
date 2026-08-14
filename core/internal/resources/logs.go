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
}

type LogsFollowProvider interface {
	PodLogsFollow(ctx context.Context, contextID, namespace, name, container string, tailLines int64) (io.ReadCloser, error)
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
	reader, err := provider.PodLogsFollow(ctx, request.ContextID, request.Namespace, request.Name, request.Container, tail)
	if err != nil {
		return nil, err
	}

	lines := make(chan LogLine, 64)
	go func() {
		defer close(lines)
		defer reader.Close()
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 64<<10), 1<<20)
		for scanner.Scan() {
			text := scanner.Text()
			if len(text) > followMaxLineLength {
				text = strings.TrimSpace(text[:followMaxLineLength]) + "…"
			}
			select {
			case lines <- LogLine{Type: "line", Text: text}:
			case <-ctx.Done():
				return
			}
		}
		if err := scanner.Err(); err != nil && ctx.Err() == nil {
			select {
			case lines <- LogLine{Type: "error", Message: err.Error()}:
			case <-ctx.Done():
			}
		}
	}()
	return lines, nil
}
