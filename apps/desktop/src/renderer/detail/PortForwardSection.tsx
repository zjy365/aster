import { ArrowRightLeft, Check, Copy, LoaderCircle, Square } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import { forwardKey, usePortForwards } from "../hooks/usePortForwards";
import type { ForwardPort } from "./port-forward-ports";

export interface PortForwardSectionProps {
  contextId: string;
  namespace: string;
  name: string;
  kind: string;
  ports: ForwardPort[];
}

/**
 * Forwardable TCP ports for one resource. Each declared port row starts or
 * stops a forward; a manual input covers pods listening on undeclared ports.
 * Forwards live in a module-scoped store, so they survive navigation.
 */
export function PortForwardSection({ contextId, namespace, name, kind, ports }: PortForwardSectionProps) {
  const { start, stop, byKey } = usePortForwards(contextId);
  const [manualPort, setManualPort] = useState("");
  const [localPorts, setLocalPorts] = useState<Record<number, string>>({});
  function startForward(podPort: number) {
    const localPort = Number(localPorts[podPort]);
    void start({
      contextId,
      namespace,
      name,
      podPort,
      kind,
      localPort: Number.isInteger(localPort) && localPort >= 1 && localPort <= 65_535 ? localPort : 0,
    });
  }

  const manualValue = Number(manualPort);
  const manualValid = Number.isInteger(manualValue) && manualValue >= 1 && manualValue <= 65_535;

  return (
    <section className="resource-detail-section port-forward-section" data-testid="port-forward-section" aria-label="Port forwarding">
      <div className="resource-section-heading">
        <div>
          <h2>Ports</h2>
          <p>Forward a TCP port to a random local port.</p>
        </div>
      </div>

      <div className="port-forward-rows">
        {ports.map((port) => {
          const key = forwardKey(kind, namespace, name, port.port);
          const entry = byKey(key);
          return (
            <div className="port-forward-row" key={key} data-testid="port-forward-row">
              <span className="port-forward-label" title={port.label}>{port.label}</span>
              <span className="port-forward-port">{port.port}/{port.protocol}</span>
              {entry?.localPort ? (
                <>
                  <span className="port-forward-local" data-testid="port-forward-local">
                    localhost:{entry.localPort}
                    {entry.pod ? <span className="port-forward-pod">via {entry.pod}</span> : null}
                  </span>
                  <CopyLocalButton port={entry.localPort} />
                  <Button
                    size="sm"
                    variant="ghost"
                    data-testid="port-forward-stop"
                    onClick={() => void stop(key)}
                  >
                    <Square aria-hidden="true" />
                    Stop
                  </Button>
                </>
              ) : (
                <>
                  <input
                    className="port-forward-input"
                    inputMode="numeric"
                    placeholder="random"
                    value={localPorts[port.port] ?? ""}
                    aria-label={`Local port for ${port.label} ${port.port}`}
                    onChange={(event) =>
                      setLocalPorts((current) => ({ ...current, [port.port]: event.target.value.replace(/[^0-9]/g, "").slice(0, 5) }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="port-forward-start"
                    disabled={entry?.busy}
                    onClick={() => startForward(port.port)}
                  >
                    {entry?.busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <ArrowRightLeft aria-hidden="true" />}
                    Forward
                  </Button>
                </>
              )}
            </div>
          );
        })}

        <form
          className="port-forward-row port-forward-manual"
          onSubmit={(event) => {
            event.preventDefault();
            if (!manualValid) return;
            startForward(manualValue);
            setManualPort("");
          }}
        >
          <span className="port-forward-label">Other port</span>
          <input
            className="port-forward-input"
            inputMode="numeric"
            placeholder="8080"
            value={manualPort}
            aria-label="Pod port"
            onChange={(event) => setManualPort(event.target.value.replace(/[^0-9]/g, ""))}
          />
          <Button size="sm" variant="outline" type="submit" disabled={!manualValid} data-testid="port-forward-manual-start">
            <ArrowRightLeft aria-hidden="true" />
            Forward
          </Button>
        </form>
      </div>

      <p className="port-forward-status" role="status" aria-live="polite">
        {[...new Set(ports.map((port) => byKey(forwardKey(kind, namespace, name, port.port))?.error).filter(Boolean))].join(" · ")}
      </p>
    </section>
  );
}

function CopyLocalButton({ port }: { port: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="resource-copy-button"
      aria-label={`Copy localhost:${port}`}
      title={copied ? "Copied" : "Copy local address"}
      onClick={() => {
        void navigator.clipboard?.writeText(`localhost:${port}`).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => undefined);
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}
