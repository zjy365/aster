package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/zjy365/aster/core/internal/resources"
	"github.com/zjy365/aster/core/internal/rpc"
	"github.com/zjy365/aster/core/internal/session"
)

type readyMessage struct {
	Type    string `json:"type"`
	Address string `json:"address"`
	Port    int    `json:"port"`
}

func main() {
	if err := run(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "aster-core: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	token := os.Getenv("ASTER_BOOTSTRAP_TOKEN")
	loader := session.NewLoader()
	sessions := session.NewManager(loader)
	resourceService := resources.NewService(sessions)
	rpcServer, err := rpc.NewServer(token, sessions, resourceService)
	if err != nil {
		return err
	}

	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	defer listener.Close()

	httpServer := &http.Server{
		Handler:           rpcServer.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	address := listener.Addr().(*net.TCPAddr)
	if err := json.NewEncoder(os.Stdout).Encode(readyMessage{
		Type:    "ready",
		Address: listener.Addr().String(),
		Port:    address.Port,
	}); err != nil {
		return fmt.Errorf("write ready message: %w", err)
	}

	serverError := make(chan error, 1)
	go func() {
		serverError <- httpServer.Serve(listener)
	}()

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case <-signalContext.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownContext)
	case err := <-serverError:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
