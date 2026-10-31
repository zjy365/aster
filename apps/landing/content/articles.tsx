import type { ReactNode } from "react";
import Link from "next/link";

type Article = {
  slug: string;
  title: string;
  description: string;
  introduction: string;
  sections: { id: string; title: string; body: ReactNode }[];
  related: string[];
};

export const articles: Article[] = [
  {
    slug: "lens-alternatives",
    title: "Lens alternatives for Kubernetes: choose by workflow",
    description: "Compare FreeLens, Headlamp, K9s and Aster by workflow: desktop, web or terminal. A practical checklist for choosing a Kubernetes client.",
    introduction: "A useful Lens alternative should fit the work you actually do: inspect a deployment, read logs, compare contexts, or review a change. Start with those tasks rather than a long feature checklist. We build Aster, one of the options below; this is a workflow guide, not an independent benchmark.",
    sections: [
      { id: "options", title: "Four options, with different starting points", body: <>
        <ul>
          <li><a href="https://github.com/freelensapp/freelens">FreeLens</a> is an open-source Kubernetes IDE. Consider it when you want to evaluate a Lens-derived desktop workflow and its extension ecosystem.</li>
          <li><a href="https://headlamp.dev/">Headlamp</a> provides a Kubernetes UI for desktop or in-cluster use, with an emphasis on extensibility. Choose between local and shared deployment based on how your team works.</li>
          <li><a href="https://k9scli.io/">K9s</a> is a terminal UI for navigating and managing Kubernetes resources. It belongs on a shortlist even when the original search was for a graphical client.</li>
          <li><Link href="/">Aster</Link> is a free, Apache-2.0 desktop workbench. It uses your kubeconfig, offers resource inspection and bounded logs, and previews supported mutations before explicit Apply.</li>
        </ul>
        <p>The official <a href="https://docs.k8slens.dev/">Lens documentation</a> is the reference for its current features and requirements. Do not assume that a historical account, licensing or telemetry complaint describes the current release of every product.</p>
      </> },
      { id: "evaluate", title: "Compare the same task in each client", body: <>
        <p>Use a development context you already have permission to access. Open one namespace, locate a workload, inspect its pods and read a short section of logs. Switch to a different context and back. Note whether the selected namespace and resource are still easy to identify.</p>
        <p>Then review how each client handles writes. What permissions does it use? Can you see the change before applying it? How does it report a failed or stale operation? A polished interface does not grant a client more permission than your cluster allows.</p>
        <p>This comparison does not require changing RBAC, creating a service account, or sharing your kubeconfig with a vendor. Read the client’s documented authentication and data handling before connecting it to a sensitive cluster.</p>
      </> },
      { id: "aster-fit", title: "When Aster is a fit, and where it stops", body: <>
        <p>Aster fits local inspection, log reading and a limited set of deliberately reviewed changes. Deployment, StatefulSet, DaemonSet and ConfigMap changes use server-side dry-run, a semantic diff and explicit confirmation. Your existing access still determines what succeeds.</p>
        <p>Its container terminal runs bounded, one-shot commands; it is not a persistent shell. Aster does not expose Secret values in the renderer or create permissions for itself. It should not be described as a complete replacement for every Kubernetes IDE feature.</p>
        <p>For a broader map of the category, see <Link href="/blog/kubernetes-gui/">desktop, web and terminal Kubernetes interfaces</Link>. For a terminal-focused comparison, read <Link href="/blog/k9s-alternatives/">K9s alternatives</Link>.</p>
      </> },
      { id: "questions", title: "Questions to settle before switching", body: <>
        <h3>Do I need a web dashboard?</h3><p>Only if the deployment and shared-access model fits your needs. A local desktop client can be useful when you already have kubeconfig access and do not want to deploy another UI into the cluster.</p>
        <h3>Will a different client fix missing permissions?</h3><p>No. A forbidden response should be investigated with your cluster administrator. Switching interfaces is not a reason to grant broad administrator access.</p>
        <h3>Which is fastest or smallest?</h3><p>This guide does not supply a comparative performance benchmark. Test the same task and release on your machine rather than treating implementation technology or an old installer size as a speed result.</p>
      </> },
    ],
    related: ["kubernetes-gui", "k9s-alternatives"],
  },
  {
    slug: "kubernetes-gui",
    title: "Kubernetes GUI: desktop clients, web UIs and terminal tools",
    description: "Choose a Kubernetes GUI by where it runs and what you need to inspect. Compare local clients, web dashboards and terminal workflows without changing cluster access.",
    introduction: "A Kubernetes GUI can make resource relationships, YAML and logs easier to inspect. The first choice is where the interface runs: on your computer, in a browser backed by a deployment, or inside a terminal. That decision affects setup, access and everyday use.",
    sections: [
      { id: "desktop", title: "Desktop clients: use an existing kubeconfig", body: <>
        <p>A desktop client is a local application that connects to the Kubernetes API using configured access. Aster and FreeLens are examples. Headlamp also offers a desktop application. Check each client’s authentication support against the actual configuration you use, especially when it relies on an external credential tool.</p>
        <p>Aster discovers kubeconfig contexts and lets you select resource kinds and namespaces, inspect details, follow logs and review supported writes. It does not deploy a browser dashboard into your cluster. The <Link href="/blog/local-kubernetes-dashboard/">local Kubernetes dashboard guide</Link> explains a first connection to a development cluster.</p>
      </> },
      { id: "web", title: "Web UIs: distinguish local access from shared deployment", body: <>
        <p><a href="https://headlamp.dev/">Headlamp</a> can run as a desktop application or in the cluster. An in-cluster UI is a different operational choice: the team needs to decide how it is deployed, authenticated, exposed and maintained.</p>
        <p>Do not make a dashboard public just to make it convenient. Its deployment and identity model should follow your team’s access policy. A link to a web UI is not a substitute for an access review.</p>
      </> },
      { id: "terminal", title: "Terminal tools remain useful alongside a GUI", body: <>
        <p><a href="https://k9scli.io/">K9s</a> provides an interactive terminal UI. kubectl remains useful for explicit commands and scripts. Neither must be replaced simply because you add a desktop client.</p>
        <p>A practical workflow is to inspect a resource in a GUI, then use a terminal command when reproducibility matters. For logs, a <Link href="/blog/kubernetes-log-viewer/">Kubernetes log viewer</Link> can help you keep container and workload context visible without replacing cluster-wide log storage.</p>
      </> },
      { id: "checklist", title: "A Kubernetes GUI evaluation checklist", body: <>
        <ol><li>Confirm that the expected context and namespace are selected before inspecting anything.</li><li>Open a known workload and check the owner relationship to its pods.</li><li>Read recent logs, choose a container and check how truncation or connection errors are reported.</li><li>Inspect how supported changes are previewed and confirmed in a development environment.</li><li>Check keyboard navigation, text legibility and how a client handles unavailable clusters.</li></ol>
        <p>Use the same context and task when comparing options. Do not interpret screenshots, vendor claims or the presence of a feature name as proof that it works in your environment.</p>
      </> },
      { id: "next", title: "Choose one interface for your next task", body: <>
        <p>If you need a local client, <Link href="/#download">download an Aster build for your platform</Link> and check the release information. If you need a shared deployment, review the chosen dashboard’s installation and authentication documentation first.</p>
        <p>For named alternatives to a familiar IDE, start with the <Link href="/blog/lens-alternatives/">Lens alternatives comparison</Link>.</p>
      </> },
    ],
    related: ["lens-alternatives", "local-kubernetes-dashboard"],
  },
  {
    slug: "k9s-alternatives",
    title: "K9s alternatives: when to add a Kubernetes desktop GUI",
    description: "Looking for a K9s alternative? Compare Aster, FreeLens and Headlamp for visual inspection, while keeping terminal tools for workflows they already handle well.",
    introduction: "Looking for a K9s alternative does not mean you need to stop using K9s. Sometimes you want a desktop view for a resource investigation, a discussion with a teammate, or a change review. Choose the interface for the task rather than assuming a GUI is always an upgrade.",
    sections: [
      { id: "keep-k9s", title: "First check what K9s already supports", body: <>
        <p>The <a href="https://k9scli.io/">official K9s feature list</a> includes resource navigation, logs, metrics, port forwarding and management commands. It would be misleading to claim that those capabilities require a desktop application.</p>
        <p>If your current workflow is comfortable and clear, keep it. A desktop alternative becomes useful when its resource layout, interaction model or change review fits a particular task better for you.</p>
      </> },
      { id: "desktop-options", title: "Three desktop options to evaluate", body: <>
        <h3>Aster: a local workbench with explicit change review</h3><p>Aster offers resource browsing, sanitized details, pod and workload logs, local port forwarding and reviewed mutations. A one-shot container terminal is available, but it is not a persistent interactive shell. The app uses your kubeconfig and does not create cluster permissions for itself.</p>
        <h3>FreeLens: a Kubernetes IDE workflow</h3><p><a href="https://github.com/freelensapp/freelens">FreeLens</a> is an open-source Kubernetes IDE. Inspect its current release and documentation if an IDE-style desktop interface is what you want to compare.</p>
        <h3>Headlamp: desktop and web deployment choices</h3><p><a href="https://headlamp.dev/">Headlamp</a> is an extensible Kubernetes UI with desktop and in-cluster deployment options. That flexibility is relevant if different members of the team need different ways to access an interface.</p>
      </> },
      { id: "test-task", title: "Try the same investigation in both interfaces", body: <>
        <p>Pick a development workload. Locate it, identify the selected context, find its pods, inspect events and read the logs of a specific container. Compare how easy it is to return to the original resource after exploring related objects.</p>
        <p>For a change-review comparison, inspect a supported mutation in a safe development environment. Check the target identity and permissions, preview the diff, and confirm how stale resource versions or rejected changes are reported. Do not use a production write as an installation test.</p>
        <p>Aster’s supported writes are deliberately narrower than “edit any Kubernetes object.” If you depend on a specific administrative action, confirm it exists before changing your daily workflow.</p>
      </> },
      { id: "combine", title: "Keep the terminal and desktop in the same workflow", body: <>
        <p>A desktop view can make a particular investigation easier to read, while terminal commands preserve repeatable steps. Neither interface fixes a wrong context, expired credentials or missing RBAC permission.</p>
        <p>Read the <Link href="/blog/kubernetes-log-viewer/">log viewer guide</Link> for a focused example, or the <Link href="/blog/kubernetes-gui/">Kubernetes GUI overview</Link> for the wider category. You can <Link href="/#download">try Aster</Link> alongside your existing tools.</p>
      </> },
    ],
    related: ["kubernetes-gui", "kubernetes-log-viewer"],
  },
  {
    slug: "kubernetes-log-viewer",
    title: "Kubernetes log viewer: inspect pod and workload logs",
    description: "Read pod and workload logs with clear cluster and container context. Learn what to check in a Kubernetes log viewer and where local bounded logs stop.",
    introduction: "A Kubernetes log viewer helps with an immediate investigation: choose the right cluster, workload and container, follow recent output, and inspect a failure. It is different from a long-term logging platform. A local client does not automatically retain historical logs after pods disappear.",
    sections: [
      { id: "kubectl", title: "kubectl logs is a capable starting point", body: <>
        <p>The <a href="https://kubernetes.io/docs/reference/kubectl/generated/kubectl_logs/">official kubectl logs reference</a> documents follow mode, container selection, selectors, previous-container logs, timestamps and bounded output. It is inaccurate to say kubectl can only read one pod or cannot follow output.</p>
        <p>A graphical viewer adds a different interaction model: you select a known resource and container in the UI, keep surrounding context visible, and move between logs and details without rebuilding the same navigation each time.</p>
      </> },
      { id: "workflow", title: "A focused log-reading workflow in Aster", body: <>
        <ol><li>Confirm the kubeconfig context and namespace, then locate the pod or workload.</li><li>Open its logs and choose the relevant container when more than one exists.</li><li>Start with recent output. Follow the stream only while it helps the investigation.</li><li>Check the reported source, timestamps and any truncation or connection notice before drawing conclusions.</li><li>Return to details and events when the log suggests a restart, scheduling problem or configuration issue.</li></ol>
        <p>Aster supports bounded pod and workload log reads and streams. Log access still requires the corresponding Kubernetes permission; the app does not create a role or bypass a forbidden response.</p>
      </> },
      { id: "limits", title: "Know what the viewer cannot recover", body: <>
        <p>Bounded output limits what the client keeps. A disconnected stream, a deleted pod or a container’s available history can all affect what you see. Do not treat a short result as proof that no earlier error happened.</p>
        <p>If you need retention, cross-service search, alerts or an audit trail, evaluate a logging system designed for those tasks. Aster’s local log viewer is for resource-level investigation, not a claim to replace centralized observability.</p>
        <p>Logs can contain credentials and personal information. Review a selected excerpt before sharing it with a colleague, an issue tracker or an external AI service.</p>
      </> },
      { id: "evaluate", title: "What to test before choosing a viewer", body: <>
        <ul><li>Container and workload selection remain visible.</li><li>Long lines, reconnects and truncated output are reported clearly.</li><li>Scrolling and text selection remain usable while output arrives.</li><li>Switching contexts does not leave you confused about which cluster produced the text.</li></ul>
        <p>These are evaluation criteria, not comparative benchmark results. Try <Link href="/#download">Aster’s current release</Link> on a development workload and compare it with the tools you already use.</p>
      </> },
    ],
    related: ["k9s-alternatives", "local-kubernetes-dashboard"],
  },
  {
    slug: "local-kubernetes-dashboard",
    title: "Local Kubernetes dashboard for kind and minikube",
    description: "Connect a local Kubernetes GUI to an existing kind or minikube context. Check kubeconfig, access and namespace selection before inspecting workloads in Aster.",
    introduction: "For a local Kubernetes dashboard, first decide whether you want a desktop client using kubeconfig or a web UI running alongside the cluster. Both can be useful. This guide starts from an existing development cluster; it does not install or change one for you.",
    sections: [
      { id: "prerequisites", title: "Confirm the cluster works before adding a UI", body: <>
        <p>Follow the <a href="https://kind.sigs.k8s.io/docs/user/quick-start/">kind quick start</a> or your cluster tool’s documentation first. Confirm that the cluster is running and that its context appears in your kubeconfig. A desktop app cannot repair a stopped container runtime or expired credentials.</p>
        <p>If you already use minikube and want its web dashboard, the <a href="https://minikube.sigs.k8s.io/docs/handbook/dashboard/">minikube dashboard documentation</a> describes the add-on and proxy workflow. That is a different deployment choice from connecting a desktop client.</p>
      </> },
      { id: "connect", title: "Connect a development context in Aster", body: <>
        <ol><li>Download a current build for your platform from the <Link href="/#download">download section</Link>.</li><li>Open Aster and select the kubeconfig source and development context you intend to inspect.</li><li>Choose a namespace and resource kind. Confirm the resource names against something you recognize in that cluster.</li><li>Open a workload, inspect its details and follow a short section of pod logs.</li><li>Switch away and back, checking the context name before every further action.</li></ol>
        <p>Aster uses your existing access. It does not need you to create a ServiceAccount or ClusterRole as a convenience setup step. Use a development cluster while learning the interface.</p>
      </> },
      { id: "troubleshoot", title: "If the expected resources do not appear", body: <>
        <h3>The context is missing</h3><p>Check the kubeconfig source you selected and whether the cluster tool wrote the context where you expect. A context name in an old file is not proof that its API endpoint still exists.</p>
        <h3>The connection fails</h3><p>Confirm the development cluster and its container runtime are running. If the kubeconfig depends on an external authentication tool, verify that tool’s setup before assuming the GUI is at fault.</p>
        <h3>The list is empty or forbidden</h3><p>Check namespace and resource kind first. A forbidden response is different from an empty list and should be resolved through the access policy, not by granting blanket administrator permissions.</p>
      </> },
      { id: "boundaries", title: "Keep local convenience separate from cluster safety", body: <>
        <p>A local cluster still has meaningful state. Inspect first, then review any supported change before applying it. Aster’s bounded one-shot terminal and reviewed mutations are not a general-purpose persistent shell or an unrestricted cluster administration layer.</p>
        <p>For more context, see the <Link href="/blog/kubernetes-gui/">Kubernetes GUI overview</Link>. If your next step is diagnosing a workload, continue with the <Link href="/blog/kubernetes-log-viewer/">log viewer guide</Link>.</p>
      </> },
    ],
    related: ["kubernetes-gui", "kubernetes-log-viewer"],
  },
];
