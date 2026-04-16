"use client";

import { Activity, Github } from "lucide-react";
import type { ReactElement } from "react";

export function Footer(): ReactElement {
  return (
    <footer className="w-full border-border/40 border-t bg-background py-12">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <span className="font-semibold text-foreground text-sm tracking-tight">
              cogni<span className="text-primary">/poly</span>
            </span>
          </div>

          <div className="flex items-center gap-6">
            <a
              href="https://github.com/cogni-dao"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Github className="size-4" />
            </a>
            <span className="text-muted-foreground text-xs">
              &copy; {new Date().getFullYear()} Cogni DAO
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
