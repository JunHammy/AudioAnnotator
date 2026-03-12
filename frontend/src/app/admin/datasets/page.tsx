"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Grid,
  Heading,
  HStack,
  IconButton,
  Input,
  Portal,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react"
import { ArrowRight, Database, Edit2, Files, Plus, Trash2 } from "lucide-react"
import api from "@/lib/axios"
import ToastWizard from "@/lib/toastWizard"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Dataset {
  id: number
  name: string
  description: string | null
  created_by: number
  created_at: string
  file_count: number
}

interface UnassignedCount {
  count: number
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DatasetsPage() {
  const router = useRouter()
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [unassignedCount, setUnassignedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")
  const [createDesc, setCreateDesc] = useState("")
  const [creating, setCreating] = useState(false)

  // Edit dialog
  const [editTarget, setEditTarget] = useState<Dataset | null>(null)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [editing, setEditing] = useState(false)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [datasetsRes, filesRes] = await Promise.all([
        api.get("/api/datasets"),
        api.get("/api/audio-files"),
      ])
      setDatasets(datasetsRes.data)
      const unassigned = (filesRes.data as { dataset_id: number | null }[]).filter(f => f.dataset_id == null).length
      setUnassignedCount(unassigned)
    } catch {
      ToastWizard.standard("error", "Failed to load datasets")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Create ──────────────────────────────────────────────────────────────────

  function openCreate() {
    setCreateName("")
    setCreateDesc("")
    setCreateOpen(true)
  }

  async function handleCreate() {
    if (!createName.trim()) return
    setCreating(true)
    try {
      const res = await api.post("/api/datasets", { name: createName.trim(), description: createDesc.trim() || null })
      setDatasets(prev => [res.data, ...prev])
      setCreateOpen(false)
      ToastWizard.standard("success", "Dataset created", `"${res.data.name}" is ready.`)
    } catch (e: any) {
      ToastWizard.standard("error", "Failed to create", e?.response?.data?.detail ?? "Unknown error")
    } finally {
      setCreating(false)
    }
  }

  // ── Edit ────────────────────────────────────────────────────────────────────

  function openEdit(e: React.MouseEvent, ds: Dataset) {
    e.stopPropagation()
    setEditTarget(ds)
    setEditName(ds.name)
    setEditDesc(ds.description ?? "")
  }

  async function handleEdit() {
    if (!editTarget) return
    setEditing(true)
    try {
      const res = await api.patch(`/api/datasets/${editTarget.id}`, {
        name: editName.trim() || undefined,
        description: editDesc.trim() || null,
      })
      setDatasets(prev => prev.map(d => d.id === editTarget.id ? res.data : d))
      setEditTarget(null)
      ToastWizard.standard("success", "Dataset updated")
    } catch (e: any) {
      ToastWizard.standard("error", "Failed to update", e?.response?.data?.detail ?? "Unknown error")
    } finally {
      setEditing(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  function openDelete(e: React.MouseEvent, ds: Dataset) {
    e.stopPropagation()
    setDeleteTarget(ds)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.delete(`/api/datasets/${deleteTarget.id}`)
      setDatasets(prev => prev.filter(d => d.id !== deleteTarget.id))
      setUnassignedCount(prev => prev + (deleteTarget.file_count ?? 0))
      setDeleteTarget(null)
      ToastWizard.standard("success", "Dataset deleted", "Files are now unassigned.")
    } catch {
      ToastWizard.standard("error", "Failed to delete dataset")
    } finally {
      setDeleting(false)
    }
  }

  const totalFiles = datasets.reduce((s, d) => s + d.file_count, 0) + unassignedCount

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box p={6} maxW="1100px">
      <HStack justify="space-between" mb={2}>
        <Box>
          <Heading size="lg" color="fg">Datasets</Heading>
          <Text color="fg.muted" fontSize="sm" mt={0.5}>
            Organise audio files into datasets · {totalFiles} file{totalFiles !== 1 ? "s" : ""} total
          </Text>
        </Box>
        <HStack gap={2}>
          <Button size="sm" variant="outline" onClick={() => router.push("/admin/files")} title="Flat view of all files">
            <Files size={14} />
            All Files
          </Button>
          <Button size="sm" colorPalette="blue" onClick={openCreate}>
            <Plus size={14} />
            New Dataset
          </Button>
        </HStack>
      </HStack>

      {loading ? (
        <Flex justify="center" py={16}><Spinner /></Flex>
      ) : (
        <Grid templateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={4} mt={6}>
          {/* Dataset cards */}
          {datasets.map(ds => (
            <Box
              key={ds.id}
              bg="bg.subtle"
              borderWidth="1px"
              borderColor="border"
              rounded="xl"
              p={5}
              cursor="pointer"
              onClick={() => router.push(`/admin/datasets/${ds.id}`)}
              _hover={{ borderColor: "blue.500", bg: "bg.muted" }}
              transition="all 0.15s"
              position="relative"
            >
              <HStack justify="space-between" mb={3}>
                <HStack gap={2}>
                  <Box
                    w="8"
                    h="8"
                    rounded="lg"
                    bg="blue.900"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    flexShrink={0}
                  >
                    <Database size={15} color="var(--chakra-colors-blue-300)" />
                  </Box>
                  <Text fontWeight="semibold" fontSize="sm" color="fg" truncate maxW="140px">
                    {ds.name}
                  </Text>
                </HStack>
                <HStack gap={1} onClick={e => e.stopPropagation()}>
                  <IconButton
                    size="2xs" variant="ghost" colorPalette="blue"
                    aria-label="Edit" title="Rename or edit description"
                    onClick={e => openEdit(e, ds)}
                  >
                    <Edit2 size={11} />
                  </IconButton>
                  <IconButton
                    size="2xs" variant="ghost" colorPalette="red"
                    aria-label="Delete" title="Delete dataset (files kept)"
                    onClick={e => openDelete(e, ds)}
                  >
                    <Trash2 size={11} />
                  </IconButton>
                </HStack>
              </HStack>

              {ds.description && (
                <Text fontSize="xs" color="fg.muted" mb={3} lineClamp={2}>
                  {ds.description}
                </Text>
              )}

              <HStack justify="space-between" align="center">
                <Badge colorPalette="blue" variant="subtle" size="sm">
                  {ds.file_count} file{ds.file_count !== 1 ? "s" : ""}
                </Badge>
                <HStack gap={1} color="blue.400" fontSize="xs">
                  <Text fontSize="xs">Open</Text>
                  <ArrowRight size={12} />
                </HStack>
              </HStack>

              <Text fontSize="10px" color="fg.muted" mt={2}>
                Created {new Date(ds.created_at).toLocaleDateString()}
              </Text>
            </Box>
          ))}

          {/* Unassigned files card */}
          <Box
            bg="bg.subtle"
            borderWidth="1px"
            borderColor={unassignedCount > 0 ? "orange.700" : "border"}
            borderStyle="dashed"
            rounded="xl"
            p={5}
            cursor={unassignedCount > 0 ? "pointer" : "default"}
            onClick={() => unassignedCount > 0 && router.push("/admin/datasets/unassigned")}
            _hover={unassignedCount > 0 ? { borderColor: "orange.500", bg: "bg.muted" } : {}}
            transition="all 0.15s"
          >
            <HStack gap={2} mb={3}>
              <Box
                w="8"
                h="8"
                rounded="lg"
                bg={unassignedCount > 0 ? "orange.900" : "bg.muted"}
                display="flex"
                alignItems="center"
                justifyContent="center"
                flexShrink={0}
              >
                <Files size={15} color={unassignedCount > 0 ? "var(--chakra-colors-orange-300)" : "var(--chakra-colors-fg-muted)"} />
              </Box>
              <Text fontWeight="semibold" fontSize="sm" color={unassignedCount > 0 ? "fg" : "fg.muted"}>
                Unassigned
              </Text>
            </HStack>

            <HStack justify="space-between" align="center">
              <Badge
                colorPalette={unassignedCount > 0 ? "orange" : "gray"}
                variant="subtle"
                size="sm"
              >
                {unassignedCount} file{unassignedCount !== 1 ? "s" : ""}
              </Badge>
              {unassignedCount > 0 && (
                <HStack gap={1} color="orange.400" fontSize="xs">
                  <Text fontSize="xs">View</Text>
                  <ArrowRight size={12} />
                </HStack>
              )}
            </HStack>

            <Text fontSize="10px" color="fg.muted" mt={2}>
              {unassignedCount > 0 ? "Not yet assigned to a dataset" : "All files are in a dataset"}
            </Text>
          </Box>

          {/* Empty state */}
          {datasets.length === 0 && unassignedCount === 0 && (
            <Box
              gridColumn="1/-1"
              py={12}
              textAlign="center"
              color="fg.muted"
            >
              <Database size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
              <Text mb={1}>No datasets yet</Text>
              <Text fontSize="sm">Create a dataset to start organising your audio files.</Text>
            </Box>
          )}
        </Grid>
      )}

      {/* ── Create dialog ───────────────────────────────────────────────────── */}
      <Dialog.Root open={createOpen} onOpenChange={({ open }) => { if (!open && !creating) setCreateOpen(false) }}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" maxW="440px">
              <Dialog.Header>
                <Dialog.Title color="fg">New Dataset</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <VStack gap={4}>
                  <Field.Root>
                    <Field.Label color="fg" fontSize="sm">Name <Text as="span" color="red.400">*</Text></Field.Label>
                    <Input
                      size="sm" placeholder="e.g. Batch_2026_03"
                      value={createName} onChange={e => setCreateName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleCreate()}
                      bg="bg.muted" borderColor="border"
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label color="fg" fontSize="sm">Description</Field.Label>
                    <Textarea
                      size="sm" placeholder="Optional — describe what this dataset contains"
                      value={createDesc} onChange={e => setCreateDesc(e.target.value)}
                      bg="bg.muted" borderColor="border" rows={3}
                    />
                  </Field.Root>
                </VStack>
              </Dialog.Body>
              <Dialog.Footer gap={2}>
                <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
                <Button size="sm" colorPalette="blue" onClick={handleCreate} loading={creating} disabled={!createName.trim()}>
                  <Plus size={13} /> Create
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* ── Edit dialog ─────────────────────────────────────────────────────── */}
      <Dialog.Root open={!!editTarget} onOpenChange={({ open }) => { if (!open && !editing) setEditTarget(null) }}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" maxW="440px">
              <Dialog.Header>
                <Dialog.Title color="fg">Edit Dataset</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <VStack gap={4}>
                  <Field.Root>
                    <Field.Label color="fg" fontSize="sm">Name</Field.Label>
                    <Input size="sm" value={editName} onChange={e => setEditName(e.target.value)} bg="bg.muted" borderColor="border" />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label color="fg" fontSize="sm">Description</Field.Label>
                    <Textarea size="sm" value={editDesc} onChange={e => setEditDesc(e.target.value)} bg="bg.muted" borderColor="border" rows={3} />
                  </Field.Root>
                </VStack>
              </Dialog.Body>
              <Dialog.Footer gap={2}>
                <Button size="sm" variant="ghost" onClick={() => setEditTarget(null)} disabled={editing}>Cancel</Button>
                <Button size="sm" colorPalette="blue" onClick={handleEdit} loading={editing}>Save</Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* ── Delete dialog ───────────────────────────────────────────────────── */}
      <Dialog.Root open={!!deleteTarget} onOpenChange={({ open }) => { if (!open && !deleting) setDeleteTarget(null) }}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.subtle" borderWidth="1px" borderColor="border" maxW="420px">
              <Dialog.Header>
                <Dialog.Title color="fg">Delete Dataset</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Text color="fg.muted" fontSize="sm">
                  Delete <Text as="span" color="fg" fontWeight="medium">"{deleteTarget?.name}"</Text>?
                </Text>
                <Text mt={2} fontSize="sm" color="fg.muted">
                  {deleteTarget?.file_count ?? 0} file{(deleteTarget?.file_count ?? 0) !== 1 ? "s" : ""} will be kept but will become unassigned.
                </Text>
              </Dialog.Body>
              <Dialog.Footer gap={2}>
                <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
                <Button size="sm" colorPalette="red" onClick={handleDelete} loading={deleting}>
                  <Trash2 size={13} /> Delete
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Box>
  )
}
