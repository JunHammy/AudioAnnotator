"use client";

import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Collapsible,
  Dialog,
  Field,
  Flex,
  Heading,
  Input,
  Portal,
  Select,
  Table,
  Text,
  createListCollection,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight, UserPlus } from "lucide-react";
import api from "@/lib/axios";
import ToastWizard from "@/lib/toastWizard";

interface Annotator {
  id: number;
  username: string;
  role: string;
  trust_score: number;
  segments_reviewed: number;
  is_active: boolean;
  created_at: string;
}

const roleOptions = createListCollection({
  items: [
    { label: "Annotator", value: "annotator" },
    { label: "Admin",     value: "admin" },
  ],
});

// ── Field-level validation ─────────────────────────────────────────────────

const USERNAME_RE = /^[a-zA-Z0-9_]{3,50}$/;

function validateCreate(username: string, password: string, confirm: string) {
  const errs: Record<string, string> = {};
  if (!username) errs.username = "Username is required.";
  else if (!USERNAME_RE.test(username)) errs.username = "3–50 chars, letters/numbers/underscore only.";
  if (!password) errs.password = "Password is required.";
  else if (password.length < 8) errs.password = "Must be at least 8 characters.";
  if (!confirm) errs.confirm = "Please confirm your password.";
  else if (password && confirm !== password) errs.confirm = "Passwords do not match.";
  return errs;
}

function validateReset(password: string, confirm: string) {
  const errs: Record<string, string> = {};
  if (!password) errs.password = "Password is required.";
  else if (password.length < 8) errs.password = "Must be at least 8 characters.";
  if (!confirm) errs.confirm = "Please confirm your password.";
  else if (password && confirm !== password) errs.confirm = "Passwords do not match.";
  return errs;
}

// ── Create Account Modal ───────────────────────────────────────────────────

function CreateModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (u: Annotator) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [role,     setRole]     = useState<string[]>(["annotator"]);
  const [errs,     setErrs]     = useState<Record<string, string>>({});
  const [loading,  setLoading]  = useState(false);

  function reset() {
    setUsername(""); setPassword(""); setConfirm(""); setRole(["annotator"]); setErrs({});
  }

  async function handleSubmit() {
    const validation = validateCreate(username, password, confirm);
    if (Object.keys(validation).length) { setErrs(validation); return; }
    setErrs({});
    setLoading(true);
    try {
      const res = await api.post("/api/users/", { username, password, role: role[0] });
      onCreated(res.data);
      ToastWizard.standard("success", "Account created", `${res.data.username} created successfully.`, 3000, true);
      reset();
      onClose();
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Unknown error.";
      // Surface server-side validation back into the form
      if (detail.toLowerCase().includes("username")) setErrs({ username: detail });
      else ToastWizard.standard("error", "Create failed", detail, 4000, true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(d) => { if (!d.open) { reset(); onClose(); } }} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.subtle" borderColor="border" borderWidth="1px" maxW="400px">
            <Dialog.Header borderBottomWidth="1px" borderColor="border" px={6} py={4}>
              <Dialog.Title color="fg">Create Account</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body px={6} py={5}>
              <Flex direction="column" gap={4}>
                <Field.Root>
                  <Field.Label color="fg" fontSize="sm">Role</Field.Label>
                  <Select.Root collection={roleOptions} value={role} onValueChange={(d) => setRole(d.value)} size="sm">
                    <Select.HiddenSelect />
                    <Select.Control>
                      <Select.Trigger bg="bg.muted" borderColor="border" color="fg">
                        <Select.ValueText />
                      </Select.Trigger>
                    </Select.Control>
                    <Portal>
                      <Select.Positioner>
                        <Select.Content bg="bg.subtle" borderColor="border">
                          {roleOptions.items.map((item) => (
                            <Select.Item key={item.value} item={item} color="fg" _hover={{ bg: "bg.muted" }}>
                              {item.label}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Positioner>
                    </Portal>
                  </Select.Root>
                </Field.Root>

                <Field.Root invalid={!!errs.username}>
                  <Field.Label color="fg" fontSize="sm">Username</Field.Label>
                  <Input
                    value={username}
                    onChange={(e) => { setUsername(e.target.value); setErrs((p) => ({ ...p, username: "" })); }}
                    placeholder="e.g. annotator_6"
                    bg="bg.muted" borderColor={errs.username ? "red.400" : "border"} color="fg" size="sm"
                  />
                  {errs.username && <Field.ErrorText fontSize="xs">{errs.username}</Field.ErrorText>}
                </Field.Root>

                <Field.Root invalid={!!errs.password}>
                  <Field.Label color="fg" fontSize="sm">Password</Field.Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setErrs((p) => ({ ...p, password: "" })); }}
                    placeholder="Min. 8 characters"
                    bg="bg.muted" borderColor={errs.password ? "red.400" : "border"} color="fg" size="sm"
                  />
                  {errs.password && <Field.ErrorText fontSize="xs">{errs.password}</Field.ErrorText>}
                </Field.Root>

                <Field.Root invalid={!!errs.confirm}>
                  <Field.Label color="fg" fontSize="sm">Confirm Password</Field.Label>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); setErrs((p) => ({ ...p, confirm: "" })); }}
                    placeholder="Confirm password"
                    bg="bg.muted" borderColor={errs.confirm ? "red.400" : "border"} color="fg" size="sm"
                  />
                  {errs.confirm && <Field.ErrorText fontSize="xs">{errs.confirm}</Field.ErrorText>}
                </Field.Root>
              </Flex>
            </Dialog.Body>
            <Dialog.Footer borderTopWidth="1px" borderColor="border" px={6} py={4} gap={3}>
              <Button variant="ghost" size="sm" color="fg.muted" onClick={onClose}>Cancel</Button>
              <Button colorPalette="blue" size="sm" loading={loading} onClick={handleSubmit}>Create Account</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

// ── Reset Password Modal ───────────────────────────────────────────────────

function ResetPwModal({ user, onClose }: { user: Annotator | null; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [errs,     setErrs]     = useState<Record<string, string>>({});
  const [loading,  setLoading]  = useState(false);

  function reset() { setPassword(""); setConfirm(""); setErrs({}); }

  async function handleSubmit() {
    const validation = validateReset(password, confirm);
    if (Object.keys(validation).length) { setErrs(validation); return; }
    setErrs({});
    setLoading(true);
    try {
      await api.patch(`/api/users/${user!.id}`, { password });
      ToastWizard.standard("success", "Password reset", `Password updated for ${user!.username}.`, 3000, true);
      reset();
      onClose();
    } catch {
      ToastWizard.standard("error", "Reset failed", "Could not update password.", 3000, true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={!!user} onOpenChange={(d) => { if (!d.open) { reset(); onClose(); } }} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="bg.subtle" borderColor="border" borderWidth="1px" maxW="380px">
            <Dialog.Header borderBottomWidth="1px" borderColor="border" px={6} py={4}>
              <Dialog.Title color="fg">Reset Password — {user?.username}</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body px={6} py={5}>
              <Flex direction="column" gap={4}>
                <Field.Root invalid={!!errs.password}>
                  <Field.Label color="fg" fontSize="sm">New Password</Field.Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setErrs((p) => ({ ...p, password: "" })); }}
                    placeholder="Min. 8 characters"
                    bg="bg.muted" borderColor={errs.password ? "red.400" : "border"} color="fg" size="sm"
                  />
                  {errs.password && <Field.ErrorText fontSize="xs">{errs.password}</Field.ErrorText>}
                </Field.Root>
                <Field.Root invalid={!!errs.confirm}>
                  <Field.Label color="fg" fontSize="sm">Confirm Password</Field.Label>
                  <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => { setConfirm(e.target.value); setErrs((p) => ({ ...p, confirm: "" })); }}
                    placeholder="Confirm password"
                    bg="bg.muted" borderColor={errs.confirm ? "red.400" : "border"} color="fg" size="sm"
                  />
                  {errs.confirm && <Field.ErrorText fontSize="xs">{errs.confirm}</Field.ErrorText>}
                </Field.Root>
              </Flex>
            </Dialog.Body>
            <Dialog.Footer borderTopWidth="1px" borderColor="border" px={6} py={4} gap={3}>
              <Button variant="ghost" size="sm" color="fg.muted" onClick={onClose}>Cancel</Button>
              <Button colorPalette="yellow" size="sm" loading={loading} onClick={handleSubmit}>Reset Password</Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function ManageAnnotatorsPage() {
  const [users,       setUsers]       = useState<Annotator[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [resetTarget, setResetTarget] = useState<Annotator | null>(null);

  useEffect(() => {
    api.get("/api/users/")
      .then((r) => setUsers(r.data))
      .finally(() => setLoading(false));
  }, []);

  async function toggleActive(user: Annotator) {
    try {
      const res = await api.patch(`/api/users/${user.id}`, { is_active: !user.is_active });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? res.data : u)));
      ToastWizard.standard(
        "success",
        res.data.is_active ? "Account enabled" : "Account disabled",
        `${user.username} ${res.data.is_active ? "re-enabled" : "disabled"}.`,
        3000, true,
      );
    } catch {
      ToastWizard.standard("error", "Update failed", "Could not update account.", 3000, true);
    }
  }

  const [disabledOpen, setDisabledOpen] = useState(false);

  const active   = users.filter((u) => u.role === "annotator" &&  u.is_active);
  const disabled = users.filter((u) => u.role === "annotator" && !u.is_active);

  return (
    <Box p={8} maxW="1100px">
      <Flex justify="space-between" align="center" mb={6}>
        <Box>
          <Heading size="lg" color="fg" mb={1}>Manage Annotators</Heading>
          <Text color="fg.muted">Create and manage annotator accounts</Text>
        </Box>
        <Button colorPalette="yellow" size="sm" onClick={() => setShowCreate(true)}>
          <UserPlus size={16} />
          Create Account
        </Button>
      </Flex>

      {/* Active annotators */}
      <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
        {loading ? (
          <Box px={5} py={8} textAlign="center"><Text color="fg.muted">Loading…</Text></Box>
        ) : (
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                {["Username", "Segments Reviewed", "Trust Score", "Status", "Created", "Actions"].map((h) => (
                  <Table.ColumnHeader key={h} color="fg.muted" fontSize="xs" px={4} py={3}>{h}</Table.ColumnHeader>
                ))}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {active.map((u) => (
                <Table.Row key={u.id} _hover={{ bg: "bg.muted" }}>
                  <Table.Cell px={4} py={3}>
                    <Text fontSize="sm" color="fg">{u.username}</Text>
                  </Table.Cell>
                  <Table.Cell px={4} py={3}>
                    <Text fontSize="sm" color="fg">{u.segments_reviewed}</Text>
                  </Table.Cell>
                  <Table.Cell px={4} py={3}>
                    <Text fontSize="sm" color="blue.400">{u.trust_score.toFixed(2)}</Text>
                  </Table.Cell>
                  <Table.Cell px={4} py={3}>
                    <Badge colorPalette="green" size="sm">Active</Badge>
                  </Table.Cell>
                  <Table.Cell px={4} py={3}>
                    <Text fontSize="xs" color="fg.muted">{new Date(u.created_at).toLocaleDateString()}</Text>
                  </Table.Cell>
                  <Table.Cell px={4} py={3}>
                    <Flex gap={2}>
                      <Button size="xs" colorPalette="yellow" variant="outline" onClick={() => setResetTarget(u)}>Reset PW</Button>
                      <Button size="xs" colorPalette="red" variant="outline" onClick={() => toggleActive(u)}>Disable</Button>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
              {active.length === 0 && (
                <Table.Row>
                  <Table.Cell colSpan={6} px={4} py={8} textAlign="center">
                    <Text color="fg.muted">No active annotators.</Text>
                  </Table.Cell>
                </Table.Row>
              )}
            </Table.Body>
          </Table.Root>
        )}
      </Box>

      {/* Disabled annotators — collapsible */}
      {!loading && disabled.length > 0 && (
        <Collapsible.Root open={disabledOpen} onOpenChange={(d) => setDisabledOpen(d.open)} mt={4}>
          <Collapsible.Trigger asChild>
            <Flex
              align="center"
              gap={2}
              px={3}
              py={2}
              rounded="md"
              cursor="pointer"
              color="fg.muted"
              fontSize="sm"
              _hover={{ bg: "bg.subtle", color: "fg" }}
              transition="all 0.15s"
              w="fit-content"
            >
              {disabledOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <Text fontSize="sm">Disabled accounts ({disabled.length})</Text>
            </Flex>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Box bg="bg.subtle" borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden" mt={2} opacity={0.75}>
              <Table.Root size="sm">
                <Table.Body>
                  {disabled.map((u) => (
                    <Table.Row key={u.id} _hover={{ bg: "bg.muted" }}>
                      <Table.Cell px={4} py={3}>
                        <Text fontSize="sm" color="fg.muted">{u.username}</Text>
                      </Table.Cell>
                      <Table.Cell px={4} py={3}>
                        <Text fontSize="sm" color="fg.muted">{u.segments_reviewed}</Text>
                      </Table.Cell>
                      <Table.Cell px={4} py={3}>
                        <Text fontSize="sm" color="fg.muted">{u.trust_score.toFixed(2)}</Text>
                      </Table.Cell>
                      <Table.Cell px={4} py={3}>
                        <Badge colorPalette="red" size="sm">Disabled</Badge>
                      </Table.Cell>
                      <Table.Cell px={4} py={3}>
                        <Text fontSize="xs" color="fg.muted">{new Date(u.created_at).toLocaleDateString()}</Text>
                      </Table.Cell>
                      <Table.Cell px={4} py={3}>
                        <Flex gap={2}>
                          <Button size="xs" colorPalette="yellow" variant="outline" onClick={() => setResetTarget(u)}>Reset PW</Button>
                          <Button size="xs" colorPalette="green" variant="outline" onClick={() => toggleActive(u)}>Enable</Button>
                        </Flex>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}

      <CreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(u) => setUsers((prev) => [u, ...prev])}
      />
      <ResetPwModal
        user={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </Box>
  );
}
