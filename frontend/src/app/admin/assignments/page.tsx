"use client";

import { Box, Heading, Text } from "@chakra-ui/react";

export default function AssignTasksPage() {
  return (
    <Box p={8}>
      <Heading size="lg" color="fg" mb={1}>Assign Tasks</Heading>
      <Text color="fg.muted">Assign annotation tasks to annotators.</Text>
    </Box>
  );
}
