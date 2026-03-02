"use client";

import { Box, Heading, Text } from "@chakra-ui/react";
import { useAuth } from "@/hooks/useAuth";

export default function AdminDashboard() {
  const { user } = useAuth();

  return (
    <Box p={8}>
      <Heading size="lg" color="fg" mb={1}>Admin Dashboard</Heading>
      <Text color="fg.muted">Welcome, {user?.username}</Text>
      {/* TODO: Stats cards, recent activity, annotator summary */}
    </Box>
  );
}
