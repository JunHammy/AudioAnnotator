"use client";

import { Box, Heading, Text } from "@chakra-ui/react";

export default function ReviewFinalizePage() {
  return (
    <Box p={8}>
      <Heading size="lg" color="fg" mb={1}>Review & Finalize</Heading>
      <Text color="fg.muted">Review annotation results and finalize decisions.</Text>
    </Box>
  );
}
