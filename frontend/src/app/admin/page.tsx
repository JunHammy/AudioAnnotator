"use client";

import { Box, Heading, Text } from "@chakra-ui/react";
import { useAuth } from "@/hooks/useAuth";

export default function AdminDashboard() {
  const { user } = useAuth();

  return (
    <Box p={8}>
      <Heading mb={2}>Admin Dashboard</Heading>
      <Text color="gray.500">Welcome, {user?.username}</Text>
      {/* TODO: Stats, file list, assignment overview */}
    </Box>
  );
}
