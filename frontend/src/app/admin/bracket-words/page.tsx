"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  IconButton,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import api from "@/lib/axios";
import ToastWizard from "@/lib/toastWizard";

interface BracketWords {
  parentheses: string[];
  square_brackets: string[];
}

// ── Word chip with remove button ──────────────────────────────────────────────

function WordChip({ word, onRemove }: { word: string; onRemove: () => void }) {
  return (
    <HStack gap={1} px={2} py={1} bg="bg.muted" rounded="md" borderWidth="1px" borderColor="border">
      <Text fontSize="sm" fontFamily="mono" color="fg">{word}</Text>
      <IconButton
        aria-label={`Remove ${word}`}
        size="xs"
        variant="ghost"
        color="fg.muted"
        _hover={{ color: "red.400" }}
        onClick={onRemove}
        minW="auto"
        h="auto"
        p={0}
      >
        <X size={12} />
      </IconButton>
    </HStack>
  );
}

// ── Word section (parentheses or square_brackets) ──────────────────────────────

function WordSection({
  title,
  bracketExample,
  words,
  onAdd,
  onRemove,
  saving,
}: {
  title: string;
  bracketExample: string;
  words: string[];
  onAdd: (word: string) => void;
  onRemove: (word: string) => void;
  saving: boolean;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed) return;
    if (words.includes(trimmed)) {
      ToastWizard.standard("warning", "Word already in list");
      return;
    }
    onAdd(trimmed);
    setInput("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
  };

  return (
    <Box
      bg="bg.subtle"
      borderWidth="1px"
      borderColor="border"
      rounded="lg"
      overflow="hidden"
    >
      <Box px={5} py={4} borderBottomWidth="1px" borderColor="border">
        <Flex align="center" gap={3}>
          <Heading size="sm" color="fg">{title}</Heading>
          <Badge colorPalette="blue" size="sm" fontFamily="mono">{bracketExample}</Badge>
          <Badge size="sm" colorPalette="gray">{words.length} word{words.length !== 1 ? "s" : ""}</Badge>
        </Flex>
        <Text fontSize="xs" color="fg.muted" mt={1}>
          Words shown here will be highlighted in transcriptions as filler words.
        </Text>
      </Box>

      <Box px={5} py={4}>
        {/* Word chips */}
        {words.length > 0 ? (
          <Flex gap={2} wrap="wrap" mb={4}>
            {words.map(w => (
              <WordChip key={w} word={w} onRemove={() => onRemove(w)} />
            ))}
          </Flex>
        ) : (
          <Text fontSize="sm" color="fg.muted" mb={4}>No words yet. Add one below.</Text>
        )}

        {/* Add input */}
        <HStack gap={2} maxW="400px">
          <Input
            ref={inputRef}
            size="sm"
            placeholder="Type a word and press Enter…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            fontFamily="mono"
          />
          <Button
            size="sm"
            colorPalette="blue"
            loading={saving}
            disabled={!input.trim()}
            onClick={handleAdd}
          >
            <Plus size={14} />
            Add
          </Button>
        </HStack>
      </Box>
    </Box>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BracketWordsPage() {
  const [data, setData] = useState<BracketWords | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/admin/bracket-words")
      .then(r => setData(r.data))
      .catch(() => ToastWizard.standard("error", "Failed to load bracket words"))
      .finally(() => setLoading(false));
  }, []);

  async function patch(update: Partial<BracketWords>) {
    setSaving(true);
    try {
      const res = await api.patch("/api/admin/bracket-words", update);
      setData(res.data);
    } catch {
      ToastWizard.standard("error", "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function addWord(field: keyof BracketWords, word: string) {
    if (!data) return;
    await patch({ [field]: [...data[field], word] });
  }

  async function removeWord(field: keyof BracketWords, word: string) {
    if (!data) return;
    await patch({ [field]: data[field].filter(w => w !== word) });
  }

  return (
    <Box p={8} maxW="800px">
      <Heading size="lg" color="fg" mb={1}>Bracket Words</Heading>
      <Text color="fg.muted" mb={6}>
        Manage filler words that are highlighted in transcriptions using parentheses{" "}
        <Text as="span" fontFamily="mono" color="fg">(word)</Text> or square brackets{" "}
        <Text as="span" fontFamily="mono" color="fg">[word]</Text>.
        Changes are saved immediately.
      </Text>

      {loading ? (
        <Flex justify="center" py={12}>
          <Spinner />
        </Flex>
      ) : data ? (
        <VStack align="stretch" gap={5}>
          <WordSection
            title="Parentheses words"
            bracketExample="(word)"
            words={data.parentheses}
            onAdd={w => addWord("parentheses", w)}
            onRemove={w => removeWord("parentheses", w)}
            saving={saving}
          />
          <WordSection
            title="Square bracket words"
            bracketExample="[word]"
            words={data.square_brackets}
            onAdd={w => addWord("square_brackets", w)}
            onRemove={w => removeWord("square_brackets", w)}
            saving={saving}
          />
        </VStack>
      ) : (
        <Text color="fg.muted">Could not load data.</Text>
      )}
    </Box>
  );
}
