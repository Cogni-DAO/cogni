import Image from "next/image";
import Link from "next/link";
import type { ReactElement } from "react";

import { FOOTER_COLUMNS } from "./footer-items";

export function AppFooter(): ReactElement {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/TransparentBrainOnly.png"
                alt="Cogni"
                width={24}
                height={24}
              />
              <span className="font-bold text-gradient-accent">Cogni</span>
            </Link>
            <p className="mt-3 text-muted-foreground text-sm">
              Web3 Gov + Web2 AI
            </p>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="font-semibold text-foreground text-sm">
                {column.title}
              </h3>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 border-t pt-6">
          <p className="text-center text-muted-foreground text-xs">
            &copy; {new Date().getFullYear()} Cogni DAO. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
