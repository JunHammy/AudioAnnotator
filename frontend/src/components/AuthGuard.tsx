"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import ToastWizard from "@/lib/toastWizard";

interface Props {
  role?: "admin" | "annotator";
  children: React.ReactNode;
}

export function AuthGuard({ role, children }: Props) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const toasted = useRef(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || isLoading) return;
    if (!user) {
      if (!toasted.current) {
        toasted.current = true;
        ToastWizard.standard("warning", "Login required", "Please log in to continue.", 3000);
      }
      router.replace("/login");
      return;
    }
    if (role && user.role !== role) {
      if (!toasted.current) {
        toasted.current = true;
        ToastWizard.standard("error", "Access denied", `This area is for ${role}s only.`, 3000);
      }
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
