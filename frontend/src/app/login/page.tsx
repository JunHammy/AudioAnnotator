"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  Center,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Stack,
  Text,
  useToast,
} from "@chakra-ui/react";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();
  const toast = useToast();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(username, password);
      router.replace(user.role === "admin" ? "/admin" : "/annotator");
    } catch {
      toast({ title: "Login failed", description: "Invalid credentials", status: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Center minH="100vh" bg="gray.50">
      <Box bg="white" p={8} rounded="lg" shadow="md" w="full" maxW="400px">
        <Stack spacing={6} as="form" onSubmit={handleSubmit}>
          <Heading size="lg" textAlign="center">
            AudioAnnotator
          </Heading>
          <FormControl isRequired>
            <FormLabel>Username</FormLabel>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </FormControl>
          <FormControl isRequired>
            <FormLabel>Password</FormLabel>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormControl>
          <Button type="submit" colorScheme="blue" isLoading={loading} w="full">
            Sign in
          </Button>
        </Stack>
      </Box>
    </Center>
  );
}
