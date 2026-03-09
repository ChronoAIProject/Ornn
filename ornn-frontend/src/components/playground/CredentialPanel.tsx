/**
 * Credential Panel Component.
 * Manages credential CRUD within the playground sidebar.
 * Values are never displayed after creation (security by design).
 * @module components/playground/CredentialPanel
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useCredentials,
  useCreateCredential,
  useDeleteCredential,
  useUpdateCredential,
} from "@/hooks/usePlaygroundCredentials";
import { PencilIcon, XIcon } from "./PlaygroundIcons";

export function CredentialPanel() {
  const { data: credentials, isLoading } = useCredentials();
  const createMutation = useCreateCredential();
  const deleteMutation = useDeleteCredential();
  const updateMutation = useUpdateCredential();

  // Generic credential form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const resetForm = () => {
    setShowForm(false);
    setEditId(null);
    setName("");
    setValue("");
    setError("");
  };

  const handleCreate = () => {
    if (!name.trim() || !value.trim()) {
      setError("Both name and value are required.");
      return;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setError("Name must start with a letter/underscore and contain only alphanumeric/underscore.");
      return;
    }

    createMutation.mutate(
      { name: name.trim(), value: value.trim() },
      {
        onSuccess: resetForm,
        onError: (err) => setError(err.message),
      },
    );
  };

  const handleUpdate = () => {
    if (!editId || !value.trim()) {
      setError("Value is required.");
      return;
    }

    updateMutation.mutate(
      { id: editId, value: value.trim() },
      {
        onSuccess: resetForm,
        onError: (err) => setError(err.message),
      },
    );
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const startEdit = (id: string) => {
    setEditId(id);
    setValue("");
    setError("");
    setShowForm(true);
  };

  const isPending =
    createMutation.isPending ||
    deleteMutation.isPending ||
    updateMutation.isPending;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------------ */}
      {/* Skill Credentials (environment variables)                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-xs uppercase tracking-wider text-text-muted">
            Skill Credentials
          </h3>
          {!showForm && (
            <button
              type="button"
              onClick={() => {
                setShowForm(true);
                setEditId(null);
                setName("");
                setValue("");
                setError("");
              }}
              className="font-body text-xs text-neon-cyan transition-colors hover:text-neon-cyan/80 cursor-pointer"
            >
              + Add
            </button>
          )}
        </div>

        <p className="font-body text-[10px] leading-relaxed text-text-muted/70">
          Environment variables that skills need to run (e.g. API keys for external services).
        </p>

        {/* Credential list */}
        {isLoading ? (
          <div className="skeleton-shimmer h-8 rounded-lg" />
        ) : (
          <div className="flex flex-wrap gap-2">
            <AnimatePresence mode="popLayout">
              {credentials?.map((cred) => (
                <motion.div
                  key={cred.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="group flex items-center gap-1.5 rounded-full border border-neon-cyan/20 bg-bg-surface/50 px-3 py-1"
                >
                  <span className="font-mono text-xs text-text-primary">
                    {cred.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(cred.id)}
                    className="hidden text-text-muted transition-colors hover:text-neon-cyan group-hover:inline-block cursor-pointer"
                    aria-label={`Edit ${cred.name}`}
                  >
                    <PencilIcon className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(cred.id)}
                    disabled={isPending}
                    className="hidden text-text-muted transition-colors hover:text-neon-red group-hover:inline-block cursor-pointer disabled:opacity-50"
                    aria-label={`Delete ${cred.name}`}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {credentials?.length === 0 && !showForm && (
              <p className="font-body text-[10px] text-text-muted">
                No skill credentials stored.
              </p>
            )}
          </div>
        )}

        {/* Add/Edit form */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-3 overflow-hidden"
            >
              {!editId && (
                <div className="flex flex-col gap-1.5">
                  <label className="font-heading text-[10px] uppercase tracking-wider text-text-muted">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="MY_API_KEY"
                    disabled={isPending}
                    className="neon-input rounded-lg px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="font-heading text-[10px] uppercase tracking-wider text-text-muted">
                  {editId ? "New Value" : "Value"}
                </label>
                <input
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="secret-value"
                  disabled={isPending}
                  className="neon-input rounded-lg px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted/50"
                />
              </div>

              {error && (
                <p className="font-body text-xs text-neon-red">{error}</p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={editId ? handleUpdate : handleCreate}
                  disabled={isPending}
                  className="glass cursor-pointer rounded-lg border border-neon-cyan/50 px-3 py-1.5 font-body text-xs font-semibold text-neon-cyan transition-all hover:border-neon-cyan disabled:opacity-50"
                >
                  {isPending ? "Saving..." : editId ? "Update" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={isPending}
                  className="cursor-pointer rounded-lg px-3 py-1.5 font-body text-xs text-text-muted transition-colors hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

