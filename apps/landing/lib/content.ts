/**
 * All landing-page copy lives here so the future `[locale]` wrapper has a
 * single source to translate. English only for now.
 *
 * Voice rules for this file:
 *  - Write for someone deciding whether to install Aster, not for someone
 *    reviewing its source. Say what they get, not how it is built.
 *  - No internal route names, process topology, or Kubernetes API vocabulary
 *    that a user would not type themselves.
 *  - Every claim must still be true and traceable to core/ or PRODUCT.md.
 *    No customer claims, benchmarks, telemetry, or invented metrics.
 */

export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix a static asset with the deploy base path (GitHub Pages project site). */
export const asset = (path: string) => `${basePath}${path}`;

export const site = {
  title: "Aster — A quiet workbench for Kubernetes",
  description:
    "A Kubernetes desktop app that runs entirely on your machine. Find anything in seconds, watch it change live, and see exactly what a change will do before it happens.",
  repo: "https://github.com/zjy365/aster",
  releasesUrl: "https://github.com/zjy365/aster/releases",
  licenseUrl: "https://github.com/zjy365/aster/blob/main/LICENSE",
} as const;

export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type FeatureCard = {
  title: string;
  body: string;
  span: string;
  media?: "resources" | "palette" | "diff";
  hint?: string;
};

export type FooterLink = NavLink;

export const nav: { links: NavLink[]; download: string } = {
  links: [
    { label: "Features", href: "#features" },
    { label: "Security", href: "#security" },
    { label: "FAQ", href: "#faq" },
    { label: "GitHub", href: site.repo, external: true },
  ],
  download: "Download",
};

export const hero = {
  titleLine1: "Cluster work,",
  titleLine2Before: "done ",
  titleLine2Em: "deliberately",
  titleLine2After: ".",
  sub: "Aster is a Kubernetes desktop app that runs entirely on your machine. Find anything in seconds, watch it change live, and see exactly what a change will do before it happens.",
  primaryCta: { label: "Download for macOS", href: "#download" },
  secondaryCta: { label: "View on GitHub", href: site.repo, external: true },
  note: "Free and open source · macOS, Windows & Linux · No account required",
  windowTitle: "Aster — Deployments · production",
  screenshot: {
    src: "/media/aster-resources.png",
    alt: "The Aster main window: a sidebar of workload kinds beside a dense Deployments table showing status, ready count, and age",
    width: 2560,
    height: 1600,
  },
  palette: {
    src: "/media/aster-command-palette.png",
    alt: "Aster's command palette open over the resource table, listing actions, clusters, and resource kinds with keyboard hints",
    width: 2560,
    height: 1600,
  },
} as const;

export const principles = [
  {
    title: "Runs on your machine",
    body: "No account, no sign-in, nothing uploaded. Aster talks to your clusters and to nothing else.",
  },
  {
    title: "Uses your own access",
    body: "Aster can only see and do what your kubeconfig already allows. It never grants itself more.",
  },
  {
    title: "Nothing changes by surprise",
    body: "Every change is previewed first. You see exactly what will happen, then decide.",
  },
  {
    title: "Free and open source",
    body: "Apache-2.0, auditable by anyone, with no paid tier waiting behind a feature.",
  },
] as const;

export const features: { head: { title: string; body: string }; cards: FeatureCard[] } = {
  head: {
    title: "Made for the work you actually do.",
    body: "Find things fast, understand what you are looking at, and change it without holding your breath.",
  },
  cards: [
    {
      title: "Find anything, instantly",
      body: "Type a name and go. Aster searches across every kind and namespace, and keeps thousands of objects scrolling smoothly — no waiting for a giant list to load first.",
      span: "lg:col-span-7",
      media: "resources",
    },
    {
      title: "⌘K for everything",
      body: "Switch clusters, jump to any resource, run an action. Your hands never leave the keyboard, and you never lose your place.",
      span: "lg:col-span-5",
      media: "palette",
    },
    {
      title: "See the change before you make it",
      body: "Scale something, update an image, restart a workload — Aster shows you exactly what will change, confirms nothing moved underneath you, and waits for your go-ahead.",
      span: "lg:col-span-12",
      media: "diff",
    },
    {
      title: "Logs that keep up",
      body: "Follow logs live from one pod or a whole workload, search the scrollback, and run a one-off command inside a container when you need a closer look.",
      span: "lg:col-span-4",
    },
    {
      title: "A record of what you did",
      body: "Every change you make is written to a local log, per cluster. When someone asks what happened last Tuesday, you have an answer.",
      span: "lg:col-span-4",
    },
    {
      title: "Know your cluster at a glance",
      body: "Open a cluster and see what is actually running — namespaces, workloads, and Helm releases on one screen. Getting oriented takes a look, not a hunt.",
      span: "lg:col-span-4",
    },
    {
      title: "Helm without the terminal",
      body: "Browse every release, read its values, roll one back, or remove it — with the same preview-then-confirm step as everything else.",
      span: "lg:col-span-6",
    },
    {
      title: "Your place is always saved",
      body: "Open a YAML tab, read the events, check what else is related — then come back to the exact row and scroll position you left behind.",
      span: "lg:col-span-6",
      hint: "⌘K to jump anywhere",
    },
  ],
};

export const security = {
  sectionId: "security",
  head: {
    title: "Your clusters. Your machine. Your rules.",
    body: "Aster is an app on your desktop, not a dashboard on a server. There is no service in the middle and no account to create — which means there is nowhere for your credentials to go.",
  },
  diagram: {
    from: "Your machine",
    to: "Your cluster",
    caption: "That is the whole diagram. There is no Aster server.",
  },
  items: [
    {
      title: "Nothing leaves your laptop",
      body: "No account, no analytics, no crash reports, no phone-home. The only thing Aster connects to is the cluster you point it at.",
    },
    {
      title: "It can only do what you can do",
      body: "Aster works with the access your kubeconfig already has. It will not create roles or permissions to hand itself more.",
    },
    {
      title: "Secrets stay secret",
      body: "Secret values are never shown on screen and can never be edited from Aster — not by you, not by accident.",
    },
  ],
} as const;

export const download = {
  head: {
    title: "Get Aster.",
    body: "Free and open source. Point it at the kubeconfig you already have and you are working in under a minute.",
  },
  unreleased: {
    title: "Not packaged yet",
    body: "Aster is still pre-release, so there are no installers to download today. Clone the repo to run it locally, or watch the repository to hear when the first build ships.",
    primaryCta: "View on GitHub",
    secondaryCta: "Watch releases",
  },
} as const;

export const faq = [
  {
    q: "Where do my credentials go?",
    a: "Nowhere. Aster reads your kubeconfig to find your clusters, and that is the end of it — the file, its tokens, and anything sensitive inside stay on your machine. There is no server to send them to.",
  },
  {
    q: "Does Aster track me?",
    a: "No. No account, no analytics, no crash reporting, no update pings. The only network traffic Aster makes is to the clusters listed in your own kubeconfig.",
  },
  {
    q: "What can Aster change in my cluster?",
    a: "Six things: scale a workload, update its image, restart it, apply edited YAML, create a resource, and delete one. Each shows you a preview first and waits for you to confirm. Secrets cannot be edited at all.",
  },
  {
    q: "Will it slow down on a big cluster?",
    a: "Big clusters are the point. Aster loads one page of results at a time instead of the whole namespace, and draws only the rows on screen — so a namespace with thousands of objects scrolls like one with ten.",
  },
  {
    q: "Which clusters does it work with?",
    a: "Any cluster in your kubeconfig — managed, self-hosted, or a local kind or minikube. Aster reads the same file kubectl does and lists every context it finds.",
  },
  {
    q: "How is this different from a web dashboard?",
    a: "A dashboard lives on a server that needs its own credentials and its own permissions, and someone has to keep it patched. Aster is an app on your laptop that borrows the access you already have. Nothing to deploy, nothing to secure, nothing new to log into.",
  },
] as const;

export const footer: { brand: string; columns: { title: string; links: FooterLink[] }[] } = {
  brand:
    "A Kubernetes desktop app that runs on your machine. Fast on big clusters, careful with every change.",
  columns: [
    {
      title: "Product",
      links: [
        { label: "Features", href: "#features" },
        { label: "Security", href: "#security" },
        { label: "Download", href: "#download" },
      ],
    },
    {
      title: "Project",
      links: [
        { label: "GitHub", href: site.repo, external: true },
        { label: "Releases", href: site.releasesUrl, external: true },
        { label: "License", href: site.licenseUrl, external: true },
      ],
    },
  ],
};
