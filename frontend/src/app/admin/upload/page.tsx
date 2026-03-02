"use client";

import { Box, Heading, Text } from "@chakra-ui/react";

export default function UploadFilesPage() {
  return (
    <Box p={8}>
      <Heading size="lg" color="fg" mb={1}>Upload Files</Heading>
      <Text color="fg.muted">Upload audio files and associated annotation JSON files.</Text>
    </Box>
  );
}
