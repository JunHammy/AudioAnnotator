"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Center, Field, Heading, Input, Spinner, Stack } from "@chakra-ui/react";
import { useAuth } from "@/hooks/useAuth";
import ToastWizard from "@/lib/toastWizard";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { user, isLoading, login } = useAuth();
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  // Tracks whether *this component* triggered the login — if so, skip the
  // "already logged in" effect so we don't fire two toasts on re-login.
  const justLoggedIn = useRef(false);

  // Redirect if arriving at /login while already authenticated.
  useEffect(() => {
    if (isLoading || !user || justLoggedIn.current) return;
    ToastWizard.standard("info", "Already logged in", "Redirecting to dashboard…", 2000);
    router.replace(user.role === "admin" ? "/admin" : "/annotator");
  }, [user, isLoading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const me = await login(username, password);
      justLoggedIn.current = true; // suppress the useEffect redirect/toast
      ToastWizard.standard("success", "Welcome back!", `Logged in as ${me.username}.`, 3000, true);
      router.replace(me.role === "admin" ? "/admin" : "/annotator");
    } catch {
      ToastWizard.standard("error", "Login failed", "Invalid username or password.", 5000, true);
    } finally {
      setLoading(false);
    }
  }

  if (!mounted || isLoading) {
    return (
      <Center minH="100vh" bg="bg">
        <Spinner size="xl" colorPalette="blue" />
      </Center>
    );
  }

  return (
    <Center minH="100vh" bg="bg">
      <Box
        bg="bg.subtle"
        p={8}
        rounded="lg"
        borderWidth="1px"
        borderColor="border"
        w="full"
        maxW="400px"
      >
        <Stack gap={6} as="form" onSubmit={handleSubmit}>
          <Heading size="lg" textAlign="center" color="fg">
            AudioAnnotator
          </Heading>
          <Field.Root required>
            <Field.Label color="fg">Username</Field.Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              bg="bg.muted"
              borderColor="border"
              color="fg"
            />
          </Field.Root>
          <Field.Root required>
            <Field.Label color="fg">Password</Field.Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              bg="bg.muted"
              borderColor="border"
              color="fg"
            />
          </Field.Root>
          <Button type="submit" colorPalette="blue" loading={loading} w="full">
            Sign in
          </Button>
        </Stack>
      </Box>
    </Center>
  );
}
