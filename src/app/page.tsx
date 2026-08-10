// Placeholder landing page. Replaced in Phase 4, task 4.14.
// Exists now so the Phase 0 toolchain gate can run `next build` end to end.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="text-accent font-mono text-xs tracking-widest uppercase">
        Phase 0 · Foundation
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-balance">
        AI Component Ecosystem Portal
      </h1>
      <p className="text-muted text-lg leading-relaxed">
        A registry and template hub for Skills, Plugins, Agents, and MCP Gateways. Toolchain
        is up. Next: Phase 1 — authentication.
      </p>
      <p className="text-muted font-mono text-sm">
        See <code className="text-foreground">docs/09-implementation-plan.md</code>
      </p>
    </main>
  );
}
