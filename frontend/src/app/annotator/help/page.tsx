"use client";

import { useState } from "react";
import {
  Badge,
  Box,
  Flex,
  Grid,
  Heading,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Video } from "lucide-react";

// ── Video Slot ──────────────────────────────────────────────────────────────

function VideoSlot({ src, label }: { src: string; label: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const isImage = /\.(png|jpe?g|webp|gif)$/i.test(src);
  return (
    <Box rounded="xl" overflow="hidden" borderWidth="1px" borderColor="border" my={5} bg="bg.muted">
      {isImage ? (
        <img
          src={src}
          alt={label}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          style={{
            display: status === "ready" ? "block" : "none",
            width: "100%",
            maxHeight: "420px",
            objectFit: "contain",
          }}
        />
      ) : (
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          onCanPlay={() => setStatus("ready")}
          onError={() => setStatus("error")}
          style={{
            display: status === "ready" ? "block" : "none",
            width: "100%",
            maxHeight: "420px",
            objectFit: "contain",
            background: "#000",
          }}
        />
      )}
      {status !== "ready" && (
        <Flex direction="column" align="center" justify="center" minH="180px" gap={3} px={6} py={8}>
          <Box
            w="52px"
            h="52px"
            rounded="xl"
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <Video size={24} color="var(--chakra-colors-fg-muted)" />
          </Box>
          <Text fontSize="sm" fontWeight="medium" color="fg" textAlign="center">
            {label}
          </Text>
          <Text fontSize="xs" color="fg.muted" textAlign="center">
            Screen recording goes here
          </Text>
          <Box
            px={3}
            py={1.5}
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border"
            rounded="md"
            fontFamily="mono"
            fontSize="11px"
            color="fg.muted"
          >
            {src}
          </Box>
        </Flex>
      )}
    </Box>
  );
}

// ── Step List ───────────────────────────────────────────────────────────────

function Steps({ items }: { items: (string | React.ReactNode)[] }) {
  return (
    <VStack align="stretch" gap={2.5} my={4}>
      {items.map((item, i) => (
        <Flex key={i} gap={3} align="flex-start">
          <Box
            w="22px"
            h="22px"
            minW="22px"
            rounded="full"
            bg="blue.500"
            color="white"
            fontSize="11px"
            fontWeight="bold"
            display="flex"
            alignItems="center"
            justifyContent="center"
            mt="1px"
          >
            {i + 1}
          </Box>
          <Text fontSize="sm" color="fg" lineHeight="1.7">
            {item}
          </Text>
        </Flex>
      ))}
    </VStack>
  );
}

// ── Note / Callout ──────────────────────────────────────────────────────────

function Note({ children, color = "blue" }: { children: React.ReactNode; color?: "blue" | "orange" }) {
  const bg     = color === "orange" ? "orange.950" : "blue.950";
  const border = color === "orange" ? "orange.500" : "blue.500";
  const text   = color === "orange" ? "orange.200" : "blue.200";
  return (
    <Box
      bg={bg}
      borderLeftWidth="3px"
      borderColor={border}
      rounded="md"
      px={4}
      py={3}
      my={4}
    >
      <Text fontSize="sm" color={text} lineHeight="1.7">
        {children}
      </Text>
    </Box>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

function Section({
  id,
  number,
  title,
  intro,
  videoSrc,
  videoLabel,
  children,
}: {
  id: string;
  number: string;
  title: string;
  intro: string;
  videoSrc: string;
  videoLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      id={id}
      py={10}
      borderBottomWidth="1px"
      borderColor="border"
      scrollMarginTop="32px"
    >
      <Flex align="center" gap={3} mb={3}>
        <Box
          px={2}
          py={0.5}
          bg="blue.500"
          rounded="md"
          fontSize="xs"
          fontWeight="bold"
          color="white"
          letterSpacing="wide"
        >
          {number}
        </Box>
        <Heading size="md" color="fg">
          {title}
        </Heading>
      </Flex>
      <Text color="fg.muted" fontSize="sm" lineHeight="1.8" mb={2}>
        {intro}
      </Text>
      <VideoSlot src={videoSrc} label={videoLabel} />
      {children}
    </Box>
  );
}

// ── TOC ─────────────────────────────────────────────────────────────────────

const TOC_ITEMS = [
  { href: "#my-tasks",       label: "1.   My Tasks Overview" },
  { href: "#notifications",  label: "2.   Notifications" },
  { href: "#layout",         label: "3.   Annotation View Layout" },
  { href: "#waveform",       label: "4.   Waveform Player" },
  { href: "#speaker",        label: "5.   Speaker & Gender" },
  { href: "#transcription",  label: "6.   Transcription" },
  { href: "#emotions",       label: "7.   Annotating Emotions" },
  { href: "#complete",       label: "8.   Marking Complete" },
  { href: "#remarks",        label: "9.   Writing Remarks" },
  { href: "#shortcuts",      label: "10.  Keyboard Shortcuts" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AnnotatorHelpPage() {
  return (
    <Box h="100vh" overflowY="auto" p={{ base: 4, md: 8 }}>
      {/* Page header */}
      <Box mb={8}>
        <Heading size="xl" color="fg" mb={2}>
          Annotator Guide
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          Step-by-step help for annotating audio files — speakers, transcriptions, and emotions.
        </Text>
      </Box>

      <Grid templateColumns={{ base: "1fr", xl: "160px 1fr" }} gap={{ base: 0, xl: 8 }}>
        {/* Sticky TOC — desktop only */}
        <Box display={{ base: "none", xl: "block" }}>
          <Box position="sticky" top={0} pt={8}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted" mb={3} letterSpacing="wider" textTransform="uppercase">
              On this page
            </Text>
            <VStack align="stretch" gap={0.5}>
              {TOC_ITEMS.map((t) => (
                <Box
                  key={t.href}
                  display="block"
                  fontSize="sm"
                  color="fg.muted"
                  py={1.5}
                  px={2}
                  rounded="md"
                  cursor="pointer"
                  _hover={{ color: "fg", bg: "bg.muted" }}
                  transition="all 0.15s"
                  onClick={() =>
                    document
                      .getElementById(t.href.slice(1))
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  {t.label}
                </Box>
              ))}
            </VStack>
          </Box>
        </Box>

        {/* Main content */}
        <Box minW={0}>

          {/* ── 1. My Tasks ──────────────────────────────────────────────── */}
          <Section
            id="my-tasks"
            number="01"
            title="My Tasks Overview"
            intro="My Tasks is your home page. It shows every annotation task the admin has assigned to you and your progress on each one."
            videoSrc="/help-videos/annotator/01-my-tasks.mp4"
            videoLabel="My Tasks page with stat cards, task table, and progress column"
          >
            <Steps items={[
              "The stat cards at the top show your total tasks, tasks in progress, and completed tasks.",
              <>The task table lists each assignment with the audio filename, task type (<strong>Emotion / Speaker / Gender / Transcription</strong>), status, and progress.</>,
              <>The <strong>Progress</strong> column shows <em>X / Y segments annotated</em> for emotion tasks so you can see how much is left at a glance.</>,
              <>Click <strong>Start</strong>, <strong>Continue</strong>, or <strong>View</strong> on any row to open the Annotation View for that file.</>,
            ]} />
            <Note>
              Task types are assigned separately — you may receive a Speaker task, a Transcription task, or an Emotion task for the same file. Each must be completed independently.
            </Note>
          </Section>

          {/* ── 2. Notifications ─────────────────────────────────────────── */}
          <Section
            id="notifications"
            number="02"
            title="Notifications"
            intro="The notification bell in the sidebar shows updates that need your attention. You do not need to refresh the page to see new notifications."
            videoSrc="/help-videos/annotator/02-notifications.mp4"
            videoLabel="Bell icon with badge → click to open → notification list"
          >
            <Steps items={[
              <>Look for the <strong>bell icon</strong> in the left sidebar. A badge appears when you have unread notifications.</>,
              "Click the bell to open the notifications panel and see what has changed.",
              "Notifications are sent when the admin assigns a new task to you or replies to a remark you submitted on a file.",
              "Click a notification to go directly to the relevant file.",
              <>Once read, the badge clears. You can also mark all as read from the panel.</>,
            ]} />
          </Section>

          {/* ── 3. Layout ────────────────────────────────────────────────── */}
          <Section
            id="layout"
            number="03"
            title="Annotation View Layout"
            intro="The Annotation View is where all annotation work happens. It is split into three main areas."
            videoSrc="/help-videos/annotator/03-layout.mp4"
            videoLabel="Full annotation view showing waveform, segment accordion, and editor panel"
          >
            <Steps items={[
              <>The <strong>Waveform Player</strong> at the top shows the audio as a visual waveform. Colored regions represent speaker segments.</>,
              <>The <strong>Segment Accordion</strong> below the waveform lists every speaker segment. Each row shows the time range, speaker label, and annotation status.</>,
              <>The <strong>Segment Editor</strong> panel opens on the right when you click a segment — this is where you fill in emotion labels, speaker label, gender, and transcription.</>,
              "Your assigned task type determines which fields are active in the editor.",
            ]} />
          </Section>

          {/* ── 4. Waveform ──────────────────────────────────────────────── */}
          <Section
            id="waveform"
            number="04"
            title="Waveform Player"
            intro="The waveform lets you listen to the audio and navigate to any part of the recording. Each colored region is a speaker segment."
            videoSrc="/help-videos/annotator/04-waveform.mp4"
            videoLabel="Play/pause, seek, zoom, speed control, click-drag to add segment"
          >
            <Steps items={[
              <>Press <strong>Space</strong> or click the play button to play or pause.</>,
              "Click anywhere on the waveform to jump to that position.",
              <>Use the <strong>Zoom In / Zoom Out</strong> buttons to zoom in for fine editing or zoom out to see the full file.</>,
              <>Use the <strong>Speed</strong> dropdown (0.5× to 2×) to slow down dense speech or speed through familiar audio.</>,
              "Click and drag on the waveform to quickly add a new speaker segment covering the selected time range.",
            ]} />
            <Note>
              Existing regions are not draggable. To change a segment&apos;s start or end time, use the time inputs inside the Segment Editor panel.
            </Note>
          </Section>

          {/* ── 5. Speaker & Gender ──────────────────────────────────────── */}
          <Section
            id="speaker"
            number="05"
            title="Speaker & Gender Annotation"
            intro="Speaker and gender annotation is collaborative — all annotators on this file share the same view. Changes you save are visible to others immediately."
            videoSrc="/help-videos/annotator/05-speaker.mp4"
            videoLabel="Select segment → speaker label dropdown → gender dropdown → save"
          >
            <Steps items={[
              "Click a segment to open it in the Segment Editor.",
              <>Select a <strong>Speaker Label</strong> from the dropdown. Labels run from <strong>speaker_0</strong> upward (speaker_0, speaker_1, speaker_2…). Two special labels are always available: <strong>speaker_unknown</strong> for segments where the speaker cannot be identified, and <strong>speaker_group</strong> for segments where multiple speakers are talking simultaneously.</>,
              <>Select the speaker&apos;s <strong>Gender</strong>: Male, Female, or Unknown.</>,
              <>Click <strong>Save</strong>. The change is written to the shared collaborative copy that all annotators see.</>,
              <>If another annotator saved the same segment while you had it open, a <strong>conflict warning</strong> appears — reload to get the latest version before editing.</>,
            ]} />
            <Note>
              Speaker and Transcription annotations are shared across annotators. Emotion annotations are independent — each annotator has their own copy.
            </Note>
          </Section>

          {/* ── 6. Transcription ─────────────────────────────────────────── */}
          <Section
            id="transcription"
            number="06"
            title="Transcription Annotation"
            intro="Transcription tasks involve editing the original speech-to-text output to make it accurate. The original text is always shown above for reference."
            videoSrc="/help-videos/annotator/06-transcription.mp4"
            videoLabel="Click transcription segment → edit text → notes field → save"
          >
            <Steps items={[
              "Click a transcription segment to open the transcription editor.",
              "The original text is shown in grey above — your edited version goes in the input box below.",
              "Fix spelling, punctuation, or misheard words in the edit box.",
              <>Optionally add a note in the <strong>Notes</strong> field (e.g. &ldquo;audio too noisy to transcribe&rdquo;). Notes are included in the exported data, so use them for content-related observations. For anything you want the admin to act on, use Remarks instead.</>,
              <>Save each segment with <strong>Save</strong> or press <strong>S</strong>.</>,
            ]} />
            <Note>
              Transcription is a collaborative task shared with other annotators on this file — the same as Speaker and Gender.
            </Note>
          </Section>

          {/* ── 7. Emotions ──────────────────────────────────────────────── */}
          <Section
            id="emotions"
            number="07"
            title="Annotating Emotions"
            intro="For emotion tasks, select one or more emotion labels for each segment. You can choose as many as apply — there is no limit."
            videoSrc="/help-videos/annotator/07-emotions.mp4"
            videoLabel="Click a segment → check emotion boxes → add Other → save → pill badges shown"
          >
            <Note color="orange">
              <strong>Important:</strong> The speaker annotation for this file must be locked by the admin before emotion tasks can begin. If you do not have an emotion task yet, inform your admin — they need to assign it to you after locking the speaker annotation.
            </Note>
            <Steps items={[
              "Click a segment row to open it in the Segment Editor.",
              <>Check every emotion that applies. The seven standard options are: <strong>Neutral, Happy, Sad, Angry, Surprised, Fear, Disgust</strong>.</>,
              <>If none of the standard emotions fit, click <strong>+ Add Other…</strong> and type a short description (e.g. Excited, Curious). You can add as many Others as needed — each one becomes a separate entry like <Badge size="sm" colorPalette="purple">Other(Excited)</Badge>.</>,
              <>If you are unsure, check <strong>Ambiguous</strong>. This flags the segment for admin review without blocking your other selections.</>,
              <>Press <strong>S</strong> or click <strong>Save</strong>. The accordion row updates to show your saved emotions as pill badges.</>,
            ]} />
            <Note>
              Emotion annotations are independent — your selections are yours only and do not affect what other annotators see. Save each segment individually; navigating away without saving loses unsaved changes.
            </Note>
          </Section>

          {/* ── 8. Mark Complete ─────────────────────────────────────────── */}
          <Section
            id="complete"
            number="08"
            title="Marking a Task Complete"
            intro="Once you have annotated all segments, mark the task complete to notify the admin that it is ready for review."
            videoSrc="/help-videos/annotator/08-complete.mp4"
            videoLabel="Mark Complete button → confirmation dialog → status changes to Completed"
          >
            <Steps items={[
              <>When finished, click <strong>Mark Complete</strong> at the top of the annotation view.</>,
              "If any segments are still unannotated, a warning will list them. You can proceed anyway or go back to finish them.",
              "After confirming, the task status changes to Completed and it moves to the Completed section in My Tasks.",
              "You can still open and view the task after marking it complete.",
            ]} />
            <Note color="orange">
              When all annotators assigned to a file have marked their tasks complete, the file is <strong>automatically locked</strong>. Once locked, annotations can no longer be edited. Only the admin can unlock it — so make sure your work is fully reviewed before marking complete.
            </Note>
          </Section>

          {/* ── 9. Remarks ───────────────────────────────────────────────── */}
          <Section
            id="remarks"
            number="09"
            title="Writing Remarks to the Admin"
            intro="Use the Remarks box to flag issues with the audio file — wrong language setting, poor audio quality, missing speakers, or anything else the admin should know."
            videoSrc="/help-videos/annotator/09-remarks.mp4"
            videoLabel="Remarks text box → type message → submit"
          >
            <Steps items={[
              "The Remarks box is at the top of the Annotation View, above the waveform.",
              <>Type your message and click <strong>Submit</strong>. Example: &ldquo;Audio is in Mandarin, not English as set.&rdquo;</>,
              "The admin sees your remark in the Review page alongside your annotations.",
              "If the admin replies, their response appears below your remark the next time you open the file.",
            ]} />
          </Section>

          {/* ── 10. Shortcuts ────────────────────────────────────────────── */}
          <Section
            id="shortcuts"
            number="10"
            title="Keyboard Shortcuts"
            intro="Use keyboard shortcuts to annotate faster. Press ? anywhere in the annotation view to open the shortcuts panel."
            videoSrc="/help-videos/annotator/10-shortcuts.mp4"
            videoLabel="Space, S, N keys and the ? shortcuts panel"
          >
            <Box my={4} borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
              <Table.Root size="sm">
                <Table.Header>
                  <Table.Row bg="bg.muted">
                    <Table.ColumnHeader px={4} py={3} color="fg.muted" fontSize="xs" w="130px">Key</Table.ColumnHeader>
                    <Table.ColumnHeader px={4} py={3} color="fg.muted" fontSize="xs">Action</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {[
                    ["Space",     "Play / Pause audio"],
                    ["← / →",    "Seek backward / forward 2 seconds"],
                    ["S",        "Save the current segment"],
                    ["N",        "Jump to the next unannotated segment"],
                    ["1",        "Toggle Neutral"],
                    ["2",        "Toggle Happy"],
                    ["3",        "Toggle Sad"],
                    ["4",        "Toggle Angry"],
                    ["5",        "Toggle Surprised"],
                    ["6",        "Toggle Fear"],
                    ["7",        "Toggle Disgust"],
                    ["8",        "Add a new Other emotion entry"],
                    ["A",        "Toggle Ambiguous flag"],
                    ["Ctrl + Z", "Undo last segment save"],
                    ["?",        "Open keyboard shortcuts panel"],
                  ].map(([key, action]) => (
                    <Table.Row key={key} _hover={{ bg: "bg.muted" }}>
                      <Table.Cell px={4} py={3}>
                        <Box
                          display="inline-block"
                          px={2}
                          py={0.5}
                          bg="bg.muted"
                          borderWidth="1px"
                          borderColor="border"
                          rounded="md"
                          fontFamily="mono"
                          fontSize="12px"
                          color="fg"
                        >
                          {key}
                        </Box>
                      </Table.Cell>
                      <Table.Cell px={4} py={3}>
                        <Text fontSize="sm" color="fg">{action}</Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          </Section>

        </Box>
      </Grid>
    </Box>
  );
}
