"use client";

import { ChakraProvider } from "@chakra-ui/react";
import { AuthProvider } from "@/context/auth";
import { SSEProvider } from "@/context/sse";
import { Toaster } from "@/components/ui/toaster";
import { system } from "@/lib/theme";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <AuthProvider>
        <SSEProvider>
          {children}
          <Toaster />
        </SSEProvider>
      </AuthProvider>
    </ChakraProvider>
  );
}
