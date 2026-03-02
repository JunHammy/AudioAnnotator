"use client";

import { Box, Heading, Text } from "@chakra-ui/react";

export default function AnnotationViewPage() {
  return (
    <Box p={8}>
      <Heading size="lg" color="fg" mb={1}>Annotation View</Heading>
      <Text color="fg.muted">Annotate audio segments with emotions, speakers, and transcriptions.</Text>
    </Box>
  );
}
