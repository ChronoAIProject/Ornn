/**
 * Profile Card Component.
 * Edit display name and bio.
 * @module components/user/ProfileCard
 */

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { AvatarUpload } from "./AvatarUpload";
import type { User } from "@/types/user";

const profileSchema = z.object({
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters")
    .max(50, "Display name must be at most 50 characters"),
  bio: z
    .string()
    .max(300, "Bio must be at most 300 characters")
    .optional()
    .or(z.literal("")),
});

type ProfileFormData = z.infer<typeof profileSchema>;

export interface ProfileCardProps {
  /** Current user data. */
  user: User;
  /** Called to update profile. */
  onUpdate: (data: { displayName?: string; bio?: string; avatarUrl?: string | null }) => Promise<void>;
  /** Called to upload avatar. */
  onAvatarUpload: (file: File) => Promise<string>;
  /** Disable editing. */
  disabled?: boolean;
}

export function ProfileCard({
  user,
  onUpdate,
  onAvatarUpload,
  disabled = false,
}: ProfileCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user.displayName,
      bio: user.bio || "",
    },
  });

  // Reset form when user changes
  useEffect(() => {
    reset({
      displayName: user.displayName,
      bio: user.bio || "",
    });
    setAvatarUrl(user.avatarUrl);
  }, [user, reset]);

  const handleCancel = () => {
    reset();
    setAvatarUrl(user.avatarUrl);
    setIsEditing(false);
    setError(null);
  };

  const handleFormSubmit = async (data: ProfileFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      await onUpdate({
        displayName: data.displayName,
        bio: data.bio || undefined,
        avatarUrl: avatarUrl !== user.avatarUrl ? avatarUrl : undefined,
      });
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setIsLoading(false);
    }
  };

  const hasChanges = isDirty || avatarUrl !== user.avatarUrl;

  return (
    <Card className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-lg text-accent">Profile</h2>
        {!isEditing && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsEditing(true)}
            disabled={disabled}
          >
            Edit
          </Button>
        )}
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
          {/* Avatar */}
          <div className="flex justify-center">
            <AvatarUpload
              currentUrl={avatarUrl}
              onUpload={setAvatarUrl}
              onFileSelect={onAvatarUpload}
              disabled={isLoading}
              size="lg"
            />
          </div>

          {/* Display Name */}
          <Input
            label="Display Name"
            type="text"
            placeholder="Your display name"
            error={errors.displayName?.message}
            disabled={isLoading}
            {...register("displayName")}
          />

          {/* Bio */}
          <div className="flex flex-col gap-1.5">
            <label className="font-display text-xs uppercase tracking-wider text-meta">
              Bio
            </label>
            <textarea
              placeholder="Tell us about yourself..."
              disabled={isLoading}
              rows={3}
              className={`
                neon-input rounded-lg px-4 py-2.5 font-text text-strong
                placeholder:text-meta/50 resize-none
                ${errors.bio ? "border-b-danger!" : ""}
              `}
              {...register("bio")}
            />
            {errors.bio && (
              <span className="text-xs text-danger">{errors.bio.message}</span>
            )}
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-danger/30 bg-danger/10 p-3"
            >
              <p className="text-sm text-danger">{error}</p>
            </motion.div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCancel}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isLoading}
              disabled={isLoading || !hasChanges}
            >
              Save Changes
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {/* Avatar & Name */}
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-card">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="font-display text-2xl text-meta">
                    {user.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            <div>
              <h3 className="font-display text-lg text-strong">
                {user.displayName}
              </h3>
              <p className="font-mono text-sm text-meta">
                {user.primaryEmail}
              </p>
            </div>
          </div>

          {/* Bio */}
          {user.bio && (
            <div className="rounded-lg bg-card/50 p-4">
              <p className="font-text text-sm text-strong whitespace-pre-wrap">
                {user.bio}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
