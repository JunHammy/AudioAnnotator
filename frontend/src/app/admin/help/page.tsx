"use client";

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Flex,
  Grid,
  Heading,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Maximize2, Video } from "lucide-react";

// ── Video Slot ──────────────────────────────────────────────────────────────

function VideoSlot({ src, label }: { src: string; label: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [hovered, setHovered] = useState(false);
  const mediaRef = useRef<HTMLVideoElement & HTMLImageElement>(null);
  const isImage = /\.(png|jpe?g|webp|gif)$/i.test(src);

  // Catch already-loaded media (browser cache): events fire before React attaches handlers
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (isImage) {
      if ((el as HTMLImageElement).complete) setStatus("ready");
    } else {
      if ((el as HTMLVideoElement).readyState >= 3) setStatus("ready");
    }
  }, [isImage]);

  const openFullscreen = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen();
  };

  return (
    <Box
      position="relative"
      rounded="xl"
      overflow="hidden"
      borderWidth="1px"
      borderColor="border"
      my={5}
      bg="bg.muted"
      minH="220px"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Always keep media in DOM so the browser can load / autoplay it.
          Opacity-hide while loading rather than display:none, which blocks autoplay. */}
      {isImage ? (
        <img
          ref={mediaRef as React.RefObject<HTMLImageElement>}
          src={src}
          alt={label}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          style={{
            display: status === "error" ? "none" : "block",
            opacity: status === "ready" ? 1 : 0,
            transition: "opacity 0.35s ease",
            width: "100%",
            maxHeight: "420px",
            objectFit: "contain",
          }}
        />
      ) : (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={src}
          autoPlay
          loop
          muted
          playsInline
          onCanPlay={() => setStatus("ready")}
          onError={() => setStatus("error")}
          style={{
            display: status === "error" ? "none" : "block",
            opacity: status === "ready" ? 1 : 0,
            transition: "opacity 0.35s ease",
            width: "100%",
            maxHeight: "420px",
            objectFit: "contain",
            background: "#000",
          }}
        />
      )}

      {/* Skeleton overlay while loading */}
      {status === "loading" && (
        <Box position="absolute" inset={0}>
          <Skeleton h="full" w="full" rounded="none" />
        </Box>
      )}

      {/* Error / not-yet-recorded placeholder */}
      {status === "error" && (
        <Flex direction="column" align="center" justify="center" minH="220px" gap={3} px={6} py={8}>
          <Box
            w="52px" h="52px" rounded="xl" bg="bg.subtle"
            borderWidth="1px" borderColor="border"
            display="flex" alignItems="center" justifyContent="center"
          >
            <Video size={24} color="var(--chakra-colors-fg-muted)" />
          </Box>
          <Text fontSize="sm" fontWeight="medium" color="fg" textAlign="center">{label}</Text>
          <Text fontSize="xs" color="fg.muted" textAlign="center">Screen recording goes here</Text>
          <Box px={3} py={1.5} bg="bg.subtle" borderWidth="1px" borderColor="border"
            rounded="md" fontFamily="mono" fontSize="11px" color="fg.muted">
            {src}
          </Box>
        </Flex>
      )}

      {/* Fullscreen button on hover */}
      {status === "ready" && hovered && (
        <Box
          position="absolute" top={2} right={2}
          w="30px" h="30px" bg="blackAlpha.700" rounded="md"
          display="flex" alignItems="center" justifyContent="center"
          cursor="pointer" onClick={openFullscreen} title="Fullscreen"
          _hover={{ bg: "blackAlpha.900" }} transition="background 0.15s"
        >
          <Maximize2 size={14} color="white" />
        </Box>
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
  const bg    = color === "orange" ? "orange.950" : "blue.950";
  const border = color === "orange" ? "orange.500" : "blue.500";
  const text  = color === "orange" ? "orange.200" : "blue.200";
  return (
    <Box bg={bg} borderLeftWidth="3px" borderColor={border} rounded="md" px={4} py={3} my={4}>
      <Text fontSize="sm" color={text} lineHeight="1.7">
        {children}
      </Text>
    </Box>
  );
}

// ── Sub-heading inside a section ────────────────────────────────────────────

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text fontWeight="semibold" fontSize="sm" color="fg" mt={6} mb={1} letterSpacing="wide">
      {children}
    </Text>
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
  { href: "#dashboard",     label: "1.  Dashboard Overview" },
  { href: "#upload",        label: "2.  Uploading Audio Files" },
  { href: "#datasets",      label: "3.  Managing Datasets" },
  { href: "#files",         label: "4.  Managing Files" },
  { href: "#accounts",      label: "5.  Annotator Accounts" },
  { href: "#assign",        label: "6.  Assigning Tasks" },
  { href: "#review",        label: "7.  Reviewing Annotations" },
  { href: "#export",        label: "8.  Exporting Results" },
  { href: "#bracket-words", label: "9.  Bracket / Filler Words" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminHelpPage() {
  return (
    <Box h="100vh" overflowY="auto" p={{ base: 4, md: 8 }}>
      {/* Page header */}
      <Box mb={8}>
        <Heading size="xl" color="fg" mb={2}>
          Admin Guide
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          Everything you need to manage files, annotators, assignments, and results.
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

          {/* ── 1. Dashboard ─────────────────────────────────────────────── */}
          <Section
            id="dashboard"
            number="01"
            title="Dashboard Overview"
            intro="The dashboard gives you a live snapshot of the entire annotation project — how many files exist, how many tasks are done, which datasets are lagging, and who is actively annotating."
            videoSrc="/help-videos/admin/01-dashboard.mp4"
            videoLabel="Pan across dashboard stat cards, dataset progress, and annotator summary"
          >
            <Steps items={[
              "The five stat cards at the top show: Total Files, Files Assigned, Completed Assignments, Flagged Segments, and Under-Annotated files.",
              "Under-Annotated (orange card) counts files that have fewer than 2 emotion annotators. Click it to jump straight to the Review page.",
              "Progress by Dataset shows a progress bar per dataset. Click any dataset row to open that dataset's detail page.",
              "Task Breakdown shows overall completion rate for each task type (Speaker, Transcription, Emotion).",
              "Annotator Summary lists every annotator, how many tasks they have, and how many they have completed.",
              "Recent Activity shows the last actions taken — useful for checking if annotators are actively working.",
            ]} />
          </Section>

          {/* ── 2. Upload ────────────────────────────────────────────────── */}
          <Section
            id="upload"
            number="02"
            title="Uploading Audio Files"
            intro="There are two ways to upload files — a single file at a time, or an entire dataset folder at once. Both are on the Upload Files page."
            videoSrc="/help-videos/admin/02-upload.mp4"
            videoLabel="Single file upload flow, then folder upload with subfolder detection"
          >
            <SubHeading>Single File Upload</SubHeading>
            <Steps items={[
              <>Go to <strong>Upload Files</strong> in the sidebar and select the <strong>Single File</strong> tab.</>,
              "Drag your WAV file onto the dropzone, or click to browse.",
              <>Upload the companion JSON files. After selecting each file, set its type (Emotion / Gender, Speaker, Transcription) from the dropdown. If your JSON filenames follow the naming convention — <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>name_emotion_gender.json</code>, <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>name_speaker.json</code>, <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>name_transcription.json</code> — the type is detected automatically.</>,
              "Set the language and the number of speakers in the recording.",
              "Select an existing dataset from the dropdown, or type a new name to create one.",
              <>Click <strong>Upload</strong>. Segments are created from the JSON and the file appears in its dataset ready for assignment.</>,
            ]} />

            <SubHeading>Folder / Dataset Upload</SubHeading>
            <Steps items={[
              <>Select the <strong>Folder Upload</strong> tab, then click to select a folder.</>,
              <>The system auto-detects the upload mode based on folder structure:<br /><br />
                <strong>Dataset mode</strong> — select a root folder that contains subfolders named <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>audio/</code>, <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>emotion_gender/</code>, <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>speaker/</code>, <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>transcription/</code>. The root folder name becomes the dataset name automatically.<br /><br />
                <strong>Single-type mode</strong> — select a folder named <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>emotion_gender/</code>, <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>speaker/</code>, or <code style={{fontFamily:"monospace", background:"rgba(255,255,255,0.08)", padding:"1px 5px", borderRadius:"4px"}}>transcription/</code> directly. Files are matched to existing audio already in the system by filename stem.
              </>,
              "Review the detected subfolders and file groups shown in the preview. Any unrecognised subfolders are flagged in orange.",
              <>Click <strong>Upload All</strong> to process all grouped files.</>,
            ]} />
            <Note>
              Files inside each subfolder are matched by filename stem — the name before the extension. For example, <code style={{fontFamily:"monospace"}}>audio/file1.wav</code> is paired with <code style={{fontFamily:"monospace"}}>emotion_gender/file1.json</code>, <code style={{fontFamily:"monospace"}}>speaker/file1.json</code>, and <code style={{fontFamily:"monospace"}}>transcription/file1.json</code>. No suffix is required on the JSON filenames when using folder upload.
            </Note>
          </Section>

          {/* ── 3. Datasets ──────────────────────────────────────────────── */}
          <Section
            id="datasets"
            number="03"
            title="Managing Datasets"
            intro="Datasets group related audio files together. From the dataset overview you can see all datasets, edit their details, add files, and export."
            videoSrc="/help-videos/admin/03-datasets.mp4"
            videoLabel="Datasets list → edit dataset → add files → export buttons"
          >
            <Steps items={[
              <>Go to <strong>Datasets</strong> in the sidebar to see all datasets as cards.</>,
              <>To edit a dataset's name or other details, click the <strong>pencil icon</strong> on the dataset card.</>,
              "Click a dataset card to open its detail page, which lists all files in that dataset along with their assignment status.",
              <>Inside the dataset, the <strong>Add Files</strong> button (top right) opens a selector showing all unassigned files — tick the ones you want to move into this dataset and confirm.</>,
              <>Use the search box inside a dataset to filter files by name. Each file row lets you <strong>remove</strong> it from the dataset or <strong>move</strong> it to another dataset.</>,
              <>The <strong>Export JSON</strong> and <strong>Export CSV</strong> buttons download a zip of annotation data for every file in the dataset.</>,
            ]} />
          </Section>

          {/* ── 4. Files ─────────────────────────────────────────────────── */}
          <Section
            id="files"
            number="04"
            title="Managing Files"
            intro="Manage Files is a global view of every audio file across all datasets. Use it to monitor annotation progress, edit file metadata, manage locks, and archive or delete files."
            videoSrc="/help-videos/admin/04-files.mp4"
            videoLabel="Files list → status badges → edit metadata → lock toggles → archive"
          >
            <Steps items={[
              <>Go to <strong>Manage Files</strong> in the sidebar (below Datasets). All uploaded files appear here regardless of dataset.</>,
              <>Each row shows the filename, dataset, duration, language, number of speakers, and a row of <strong>task progress pills</strong> (Spk / Gnd / Emo / Trn) showing how many annotators have completed each task.</>,
              <>The <strong>status badge</strong> on each row shows the file's overall stage: <em>Unassigned</em>, <em>In Progress</em>, <em>Complete</em> (all annotators finished), or <em>Finalized</em> (speaker and transcription locked).</>,
              <>Click the <strong>pencil icon</strong> on a file to edit its metadata — language, number of speakers, or which dataset it belongs to.</>,
              <>The <strong>lock icons</strong> (Spk / Gnd / Trn) let you manually lock or unlock collaborative annotation tracks for a file. Locking speaker is required before emotion tasks can be assigned.</>,
              <>The <strong>Export All (JSON)</strong> and <strong>Export All (CSV)</strong> buttons at the top download annotation data for every file across all datasets as a zip. For single-file export, use the Review &amp; Finalize page.</>,
              <>To remove a file, click the <strong>archive</strong> button (orange). Archived files are hidden from all active lists. An <strong>Archived files</strong> section appears at the bottom of the page where you can <strong>restore</strong> a file or <strong>permanently delete</strong> it.</>,
            ]} />
            <Note color="orange">
              Permanent deletion removes all segments, annotations, and assignments for that file and cannot be undone. Use archiving when in doubt.
            </Note>
          </Section>

          {/* ── 5. Accounts ──────────────────────────────────────────────── */}
          <Section
            id="accounts"
            number="05"
            title="Managing Annotator Accounts"
            intro="Create and manage annotator accounts from the Manage Accounts page. Annotators can only access their own assigned tasks."
            videoSrc="/help-videos/admin/05-accounts.mp4"
            videoLabel="Manage Accounts → Create User → per-user action buttons"
          >
            <Steps items={[
              <>Go to <strong>Manage Accounts</strong> in the sidebar.</>,
              <>Click <strong>Create User</strong> and fill in a username, password, and role. Roles are <strong>admin</strong> or <strong>annotator</strong>.</>,
              "The new account appears in the table immediately. Share the username and password with the annotator — they log in at the same URL.",
              <>Each user row has individual action buttons: <strong>Reset Password</strong>, <strong>Rename</strong>, <strong>Disable</strong>, and a trash icon to permanently delete.</>,
              "Disabled accounts cannot log in but their annotations remain intact and visible in Review. Disabling is recommended over deleting — a disabled account can be re-enabled at any time.",
            ]} />
            <Note>
              There is no password recovery flow — if an annotator forgets their password, reset it from this page.
            </Note>
          </Section>

          {/* ── 6. Assign ────────────────────────────────────────────────── */}
          <Section
            id="assign"
            number="06"
            title="Assigning Tasks"
            intro="Assign annotation tasks to annotators from the Assign Tasks page. Each file can have multiple annotators with different task types, priorities, and due dates."
            videoSrc="/help-videos/admin/06-assign.mp4"
            videoLabel="Single-file assignment → bulk assign → reopen a completed task"
          >
            <Note color="orange">
              <strong>Important:</strong> Annotators cannot begin Emotion annotation until the Speaker task for that file has been locked. Always assign and complete Speaker labelling first, then assign Emotion tasks.
            </Note>

            <SubHeading>Assigning to a Single File</SubHeading>
            <Steps items={[
              <>Go to <strong>Assign Tasks</strong> in the sidebar and click a file to open its assignment panel.</>,
              "Use the play button on the file row to preview the audio before assigning.",
              <>Under <strong>Add Annotator</strong>, select an annotator, then choose the task combination (Emotion, Speaker, Transcription, or a combination).</>,
              "Optionally set a priority (High / Normal / Low) and a due date.",
              <>Click <strong>Add</strong>. The task appears in the annotator's My Tasks list and they receive a notification.</>,
              "To add another annotator or task type to the same file, repeat the Add Annotator step. Duplicate assignments are automatically skipped.",
              <>To remove an assignment, click the <strong>trash icon</strong> on that assignment row.</>,
              <>To change priority or due date on an existing assignment, click the priority badge in the <strong>Priority / Due</strong> column, make your changes, and save.</>,
            ]} />

            <SubHeading>Bulk Assignment</SubHeading>
            <Steps items={[
              <>Click the <strong>Bulk Assign</strong> button (top right of the page).</>,
              "Multi-select the files and annotators you want to assign.",
              "Choose the task combination and click Assign. Duplicate assignments are skipped automatically.",
            ]} />

            <SubHeading>Reopening a Completed Task</SubHeading>
            <Steps items={[
              "Find the assignment row for the file and annotator.",
              <>Click <strong>Reopen</strong>. The status changes from Completed → In Progress and the annotator can continue editing.</>,
              "Existing annotations are preserved — nothing is reset.",
            ]} />
          </Section>

          {/* ── 7. Review ────────────────────────────────────────────────── */}
          <Section
            id="review"
            number="07"
            title="Reviewing Annotations"
            intro="The Review & Finalize page gives you a per-file view of every annotation track. Use it to check quality, lock completed tracks, and export results."
            videoSrc="/help-videos/admin/07-review.mp4"
            videoLabel="Review page → open a file → switch tabs → emotion pills → lock toggle → export"
          >
            <Steps items={[
              <>Go to <strong>Review &amp; Finalize</strong> in the sidebar and click a file to open it.</>,
              <>Four tabs are available: <strong>Emotion</strong>, <strong>Speaker</strong>, <strong>Transcription</strong>, and <strong>Gender</strong>. Each shows the annotation data for that track.</>,
              <>In the <strong>Emotion</strong> tab, each row is a segment and each column is an annotator. Emotion labels appear as pill badges, e.g. <Badge size="sm" colorPalette="blue">Happy</Badge> <Badge size="sm" colorPalette="purple">Other(Excited)</Badge>.</>,
              <>The <strong>ambiguous</strong> warning icon (⚠) appears on an annotator's entry if they flagged that segment as ambiguous.</>,
              "The last column shows aggregated emotion counts across all annotators for each segment.",
              <>To lock or unlock a track, use the <strong>lock toggle</strong> within that tab. Locking prevents further edits by annotators.</>,
              <>To export data for this file, use the <strong>Export JSON</strong> or <strong>Export CSV</strong> buttons on the file's review page.</>,
            ]} />
            <Note>
              Edits cannot be made from this page — annotators must make changes from their Annotation View. Use the lock toggle to prevent further changes once a track is satisfactory.
            </Note>
          </Section>

          {/* ── 8. Export ────────────────────────────────────────────────── */}
          <Section
            id="export"
            number="08"
            title="Exporting Results"
            intro="Annotation data can be exported as JSON or CSV from two places — at the dataset level for a bulk download, or at the file level for a single file."
            videoSrc="/help-videos/admin/08-export.mp4"
            videoLabel="Export from dataset detail page, then from a single file in Review & Finalize"
          >
            <Steps items={[
              <>To export an entire dataset: go to <strong>Datasets</strong>, open the dataset, and click <strong>Export JSON</strong> or <strong>Export CSV</strong>. A zip file containing data for all files in the dataset is downloaded.</>,
              <>To export a single file: go to <strong>Review &amp; Finalize</strong>, open the file, and click <strong>Export JSON</strong> or <strong>Export CSV</strong> from the file's review page.</>,
            ]} />
          </Section>

          {/* ── 9. Bracket Words ─────────────────────────────────────────── */}
          <Section
            id="bracket-words"
            number="09"
            title="Bracket / Filler Words"
            intro="Bracket words are filler words (e.g. uh, um, lah, lor) that are automatically detected and marked in transcription data at export time."
            videoSrc="/help-videos/admin/09-bracket-words.mp4"
            videoLabel="Bracket Words page → add a word → save"
          >
            <Steps items={[
              <>Go to <strong>Bracket Words</strong> in the sidebar.</>,
              "The list shows all currently configured filler words.",
              <>To add a word, type it in the input field and click <strong>Add</strong>. To remove one, click the × next to it.</>,
              <>Click <strong>Save</strong> to apply the changes.</>,
              "Bracket words are detected and applied to the transcription data when you export — they are not applied retroactively to saved annotations.",
            ]} />
            <Note>
              Add bracket words before exporting. If words are added after an export has already been taken, re-export to get the updated transcriptions.
            </Note>
          </Section>

        </Box>
      </Grid>
    </Box>
  );
}
