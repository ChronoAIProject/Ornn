/**
 * Admin Skills Page.
 * All skills management with search, filtering, and delete.
 * @module pages/admin/AdminSkillsPage
 */

import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { apiGet, apiDelete } from "@/services/apiClient";
import { useToastStore } from "@/stores/toastStore";

/** Skill item shape from admin API. */
interface AdminSkill {
  guid: string;
  name: string;
  description: string;
  createdBy: string;
  createdByEmail: string;
  createdByDisplayName: string;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  tags: string[];
}

interface AdminSkillsResponse {
  items: AdminSkill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Format a date string to SGT (Asia/Singapore) timestamp. */
function formatDateSGT(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const PAGE_SIZE = 20;

export function AdminSkillsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addToast } = useToastStore();
  const [searchParams] = useSearchParams();

  const userIdFromUrl = searchParams.get("userId") || "";

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminSkill | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "skills", page, search, userIdFromUrl],
    queryFn: async () => {
      const params: Record<string, string | number | undefined> = {
        page,
        pageSize: PAGE_SIZE,
      };
      if (search) params.q = search;
      if (userIdFromUrl) params.userId = userIdFromUrl;
      const res = await apiGet<AdminSkillsResponse>("/api/web/admin/skills", params);
      return res.data!;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (skillId: string) => {
      await apiDelete(`/api/web/admin/skills/${skillId}`);
    },
    onSuccess: () => {
      addToast({ type: "success", message: "Skill deleted" });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "skills"] });
    },
    onError: (err) => {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to delete skill",
      });
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleSkillClick = (skillName: string) => {
    navigate(`/skills/${skillName}`);
  };

  const handleDeleteClick = (e: React.MouseEvent, skill: AdminSkill) => {
    e.stopPropagation();
    setDeleteTarget(skill);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.guid);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-neon-magenta neon-magenta">
          Skills
        </h1>
        <p className="mt-1 font-body text-text-muted">
          {userIdFromUrl
            ? "Skills for selected user"
            : "Manage all platform skills"}
        </p>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            label="Search Skills"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or description..."
          />
        </div>
        <Button type="submit" variant="primary" size="sm">
          Search
        </Button>
        {(search || userIdFromUrl) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch("");
              setSearchInput("");
              setPage(1);
              if (userIdFromUrl) {
                navigate("/admin/skills");
              }
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {/* Skills Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          {isLoading ? (
            <Skeleton lines={10} />
          ) : error ? (
            <div className="py-8 text-center">
              <p className="font-body text-neon-red">
                {error instanceof Error ? error.message : "Failed to load skills"}
              </p>
            </div>
          ) : data?.items.length === 0 ? (
            <p className="py-8 text-center font-body text-text-muted">
              No skills found.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neon-cyan/20">
                    <th className="px-4 py-3 text-left font-heading text-xs uppercase tracking-wider text-text-muted">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left font-heading text-xs uppercase tracking-wider text-text-muted">
                      Author
                    </th>
                    <th className="px-4 py-3 text-left font-heading text-xs uppercase tracking-wider text-text-muted">
                      Visibility
                    </th>
                    <th className="px-4 py-3 text-left font-heading text-xs uppercase tracking-wider text-text-muted">
                      Tags
                    </th>
                    <th className="px-4 py-3 text-left font-heading text-xs uppercase tracking-wider text-text-muted">
                      Created
                    </th>
                    <th className="px-4 py-3 text-left font-heading text-xs uppercase tracking-wider text-text-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((skill) => (
                    <tr
                      key={skill.guid}
                      onClick={() => handleSkillClick(skill.name)}
                      className="cursor-pointer border-b border-neon-cyan/10 transition-colors hover:bg-bg-elevated/50"
                    >
                      <td className="px-4 py-3">
                        <span className="font-heading text-sm font-medium text-neon-cyan hover:underline">
                          {skill.name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate font-body text-sm text-text-primary">
                            {skill.createdByDisplayName || skill.createdByEmail}
                          </p>
                          {skill.createdByDisplayName && (
                            <p className="truncate font-body text-xs text-text-muted">
                              {skill.createdByEmail}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge color={skill.isPrivate ? "yellow" : "green"}>
                          {skill.isPrivate ? "Private" : "Public"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {skill.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} color="muted">
                              {tag}
                            </Badge>
                          ))}
                          {skill.tags.length > 3 && (
                            <Badge color="muted">+{skill.tags.length - 3}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-body text-xs text-text-muted">
                        {formatDateSGT(skill.createdOn)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={(e) => handleDeleteClick(e as unknown as React.MouseEvent, skill)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Skill?"
      >
        <div className="space-y-4">
          <p className="font-body text-text-primary">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-neon-cyan">
              {deleteTarget?.name}
            </span>
            ?
          </p>
          <p className="font-body text-sm text-text-muted">
            This action cannot be undone. The skill will be permanently removed from the platform.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmDelete}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
