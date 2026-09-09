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
  const { entries, start, stop, byKey } = usePortForwards(contextId);
  const [manualPort, setManualPort] = useState("");
  const [manualLocalPort, setManualLocalPort] = useState("");
  const [localPorts, setLocalPorts] = useState<Record<number, string>>({});
  const visiblePorts = [...new Map(ports.map((port) => [port.port, port])).values()];
  for (const entry of entries) {
    if (entry.kind === kind && entry.namespace === namespace && entry.name === name &&
      !visiblePorts.some((port) => port.port === entry.podPort)) {
      visiblePorts.push({ label: "Other port", port: entry.podPort, protocol: "TCP" });
    }
  }
  function startForward(podPort: number, localValue = localPorts[podPort] ?? "") {
    if (!validLocalPort(localValue)) return;
    const localPort = localValue === "" ? 0 : Number(localValue);
    void start({
      contextId,
      namespace,
      name,
      podPort,
      kind,
      localPort,
    });
  }

  const manualValue = Number(manualPort);
  const manualValid = Number.isInteger(manualValue) && manualValue >= 1 && manualValue <= 65_535 && validLocalPort(manualLocalPort);

  return (
    <section className="resource-detail-section port-forward-section" data-testid="port-forward-section" aria-label="Port forwarding">
      <div className="resource-section-heading">
        <div>
          <h2>Port forwarding</h2>
          <p>Connect through a local TCP port. Leave the local port empty to assign one automatically.</p>
        </div>
      </div>

      <div className="port-forward-columns" aria-hidden="true">
        <span>Container / port</span><span>Remote port</span><span>Local port</span><span />
      </div>
      <div className="port-forward-rows">
        {visiblePorts.map((port) => {
          const key = forwardKey(kind, namespace, name, port.port);
          const entry = byKey(key);
          return (
            <div className="port-forward-row" key={key} data-testid="port-forward-row">
              <span className="port-forward-label" title={port.label}>{port.label}</span>
              <span className="port-forward-port">{port.port}/{port.protocol}</span>
              {entry?.localPort ? (
                <>
                  <div className="port-forward-address">
                    <div className="port-forward-address-line">
                      <span className="port-forward-local" data-testid="port-forward-local">localhost:{entry.localPort}</span>
                      <CopyLocalButton port={entry.localPort} />
                    </div>
                    {entry.pod ? <span className="port-forward-pod" title={entry.pod}>via {entry.pod}</span> : null}
                  </div>
                  <Button
                    variant="outline"
                    data-testid="port-forward-stop"
                    disabled={entry.busy}
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
                    placeholder="Auto"
                    value={localPorts[port.port] ?? ""}
                    aria-label={`Local port for ${port.label} ${port.port}`}
                    aria-invalid={!validLocalPort(localPorts[port.port] ?? "")}
                    title="Local port: 1–65535, or empty for a random port"
                    onChange={(event) =>
                      setLocalPorts((current) => ({ ...current, [port.port]: event.target.value.replace(/[^0-9]/g, "").slice(0, 5) }))
                    }
                  />
                  <Button
                    variant="outline"
                    data-testid="port-forward-start"
                    disabled={entry?.busy || !validLocalPort(localPorts[port.port] ?? "")}
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
            startForward(manualValue, manualLocalPort);
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
          <input
            className="port-forward-input"
            inputMode="numeric"
            placeholder="Auto"
            value={manualLocalPort}
            aria-label="Local port for other port"
            aria-invalid={!validLocalPort(manualLocalPort)}
            title="Local port: 1–65535, or empty for a random port"
            onChange={(event) => setManualLocalPort(event.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
          />
          <Button variant="outline" type="submit" disabled={!manualValid} data-testid="port-forward-manual-start">
            <ArrowRightLeft aria-hidden="true" />
            Forward
          </Button>
        </form>
      </div>

      <p className="port-forward-status" role="status" aria-live="polite">
        {[...new Set(visiblePorts.map((port) => byKey(forwardKey(kind, namespace, name, port.port))?.error).filter(Boolean))].join(" · ")}
      </p>
    </section>
  );
}

function validLocalPort(value: string): boolean {
  return value === "" || (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 65_535);
}

function CopyLocalButton({ port }: { port: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
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
    </Button>
  );
}
