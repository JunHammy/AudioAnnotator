"use client";

import { Box, Heading, Text } from "@chakra-ui/react";

export default function ManageAnnotatorsPage() {
  return (
    <Box p={8}>
      <Heading size="lg" color="fg" mb={1}>Manage Annotators</Heading>
      <Text color="fg.muted">Create and manage annotator accounts.</Text>
    </Box>
  );
}
