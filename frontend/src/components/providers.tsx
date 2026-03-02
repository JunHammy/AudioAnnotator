"use client";

import { ChakraProvider } from "@chakra-ui/react";
import { AuthProvider } from "@/context/auth";
import { Toaster } from "@/components/ui/toaster";
import { system } from "@/lib/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <AuthProvider>
        {children}
        <Toaster />
      </AuthProvider>
    </ChakraProvider>
  );
}
