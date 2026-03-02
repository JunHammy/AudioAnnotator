"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Center, Spinner } from "@chakra-ui/react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  role?: "admin" | "annotator";
  children: React.ReactNode;
}

export function AuthGuard({ role, children }: Props) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (role && user.role !== role) {
      router.replace(user.role === "admin" ? "/admin" : "/annotator");
    }
  }, [user, isLoading, role, router]);

  if (isLoading || !user || (role && user.role !== role)) {
    return (
      <Center h="100vh">
        <Spinner size="xl" />
      </Center>
    );
  }

  return <>{children}</>;
}
