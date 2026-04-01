// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { redirect } from "next/navigation";
import type { ReactElement } from "react";

import { HomeContent } from "@/features/home/components/HomeStats";
import { NewHomeHero } from "@/features/home/components/NewHomeHero";
import { getServerSessionUser } from "@/lib/auth/server";

import { AuthRedirect } from "./AuthRedirect";

export default async function HomePage(): Promise<ReactElement> {
  const user = await getServerSessionUser();
  if (user) {
    redirect("/chat");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AuthRedirect />
      <NewHomeHero />
      <HomeContent />
    </div>
  );
}
