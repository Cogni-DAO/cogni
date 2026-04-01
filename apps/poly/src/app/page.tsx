import type { ReactElement } from "react";

import { Content } from "@/components/Content";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";

// biome-ignore lint/style/noDefaultExport: required by Next.js
export default function HomePage(): ReactElement {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <Content />
      </main>
      <Footer />
    </div>
  );
}
