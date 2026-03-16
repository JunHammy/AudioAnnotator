"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  role?: "admin" | "annotator";
  children: React.ReactNode;
}

export function AuthGuard({ role, children }: Props) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (role && user.role !== role) {
      router.replace(user.role === "admin" ? "/admin" : "/annotator");
    }
  }, [mounted, user, isLoading, role, router]);

  // Return null until client-side hydration completes — prevents server/client
  // CSS-in-JS class name mismatch from Chakra's emotion runtime.
  if (!mounted || isLoading || !user || (role && user.role !== role)) {
    return null;
  }

  return <>{children}</>;
}
