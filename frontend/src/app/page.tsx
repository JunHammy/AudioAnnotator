"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Spinner, Center } from "@chakra-ui/react";

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
    } else if (user.role === "admin") {
      router.replace("/admin");
    } else {
      router.replace("/annotator");
    }
  }, [user, isLoading, router]);

  return (
    <Center h="100vh">
      <Spinner size="xl" />
    </Center>
  );
}
