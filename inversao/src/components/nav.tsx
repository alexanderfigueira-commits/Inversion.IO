"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Analisar" },
  { href: "/resultado", label: "Resultado" },
  { href: "/historico", label: "Histórico" },
  { href: "/definicoes", label: "Definições" },
] as const;

// Barra em baixo no telemóvel (ao alcance do polegar) e ligações no topo no computador.
export function Nav({ variant }: { variant: "top" | "bottom" }) {
  const pathname = usePathname();

  const list = items.map((item) => {
    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={
            variant === "top"
              ? `rounded px-2 py-1 text-base ${active ? "text-ink underline decoration-ouro decoration-2 underline-offset-8" : "text-soft hover:text-ink"}`
              : `flex min-h-12 items-center justify-center px-1 text-sm ${active ? "text-ink font-semibold" : "text-soft"}`
          }
        >
          {item.label}
        </Link>
      </li>
    );
  });

  if (variant === "top") {
    return (
      <nav aria-label="Principal" className="hidden md:block">
        <ul className="flex gap-4">{list}</ul>
      </nav>
    );
  }

  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-4">{list}</ul>
    </nav>
  );
}
