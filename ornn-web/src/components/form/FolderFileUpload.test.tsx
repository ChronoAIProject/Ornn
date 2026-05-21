/**
 * FolderFileUpload tests — pins the #655 upload-validation contract.
 *
 * What we lock in:
 *   1. Duplicate filename inside the SAME target folder → rejected,
 *      inline error visible, parent's `onUpload` never called.
 *   2. Duplicate filename in a DIFFERENT folder is allowed (they end
 *      up as different paths in the final ZIP).
 *   3. File over 10 MiB → rejected with size-cap error, `onUpload`
 *      not called.
 *   4. Successful upload clears any prior error.
 *
 * @module components/form/FolderFileUpload.test
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { FolderFileUpload } from "./FolderFileUpload";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (!opts) return key;
      // Echo back something searchable for the assertions.
      const parts = Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(" ");
      return `${key} (${parts})`;
    },
  }),
}));

function makeFile(name: string, sizeBytes: number, type = "text/plain"): File {
  // jsdom File supports a `size` property derived from the parts; pad
  // with a zero-filled string of the requested length.
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

function setup(initial?: Map<string, File[]>) {
  const onUpload = vi.fn();
  const onRemove = vi.fn();
  // The component expects `Map<UploadableFolder, File[]>`. Cast for
  // test ergonomics — runtime shape is the same.
  const files = (initial ?? new Map()) as unknown as Map<
    "scripts" | "references" | "assets",
    File[]
  >;
  const utils = render(
    <FolderFileUpload
      files={files as Map<"scripts" | "references" | "assets", File[]>}
      onUpload={onUpload}
      onRemove={onRemove}
    />,
  );
  const hiddenInput = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { onUpload, onRemove, hiddenInput, ...utils };
}

describe("FolderFileUpload (#655)", () => {
  it("accepts a fresh file under the size cap", () => {
    const { onUpload, hiddenInput } = setup();
    const file = makeFile("run.js", 1024);
    fireEvent.change(hiddenInput, { target: { files: [file] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload).toHaveBeenCalledWith("scripts", file);
  });

  it("rejects a duplicate filename in the same folder", () => {
    const existing = makeFile("run.js", 100);
    const { onUpload, hiddenInput } = setup(
      new Map([["scripts", [existing]]]) as never,
    );
    const dup = makeFile("run.js", 200);
    fireEvent.change(hiddenInput, { target: { files: [dup] } });
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText(/guided\.fileDuplicate/)).toBeInTheDocument();
  });

  it("allows the same filename in a DIFFERENT folder", () => {
    // `README.md` in scripts/ is fine even if references/ has one too —
    // they're separate paths in the final ZIP.
    const existing = makeFile("README.md", 100);
    const { onUpload, hiddenInput, container } = setup(
      new Map([["references", [existing]]]) as never,
    );
    // Default selected folder is `scripts`, so this should pass.
    const sameName = makeFile("README.md", 200);
    fireEvent.change(hiddenInput, { target: { files: [sameName] } });
    expect(onUpload).toHaveBeenCalledWith("scripts", sameName);
    expect(container.textContent).not.toMatch(/guided\.fileDuplicate/);
  });

  it("rejects an over-cap file", () => {
    const { onUpload, hiddenInput } = setup();
    const huge = makeFile("blob.bin", 11 * 1024 * 1024);
    fireEvent.change(hiddenInput, { target: { files: [huge] } });
    expect(onUpload).not.toHaveBeenCalled();
    expect(screen.getByText(/guided\.fileTooLarge/)).toBeInTheDocument();
  });

  it("clears the error on next successful upload", () => {
    const { onUpload, hiddenInput } = setup();
    // Trigger a size-cap rejection.
    fireEvent.change(hiddenInput, {
      target: { files: [makeFile("blob.bin", 11 * 1024 * 1024)] },
    });
    expect(screen.getByText(/guided\.fileTooLarge/)).toBeInTheDocument();
    // Now a valid upload — error must clear.
    fireEvent.change(hiddenInput, {
      target: { files: [makeFile("ok.js", 100)] },
    });
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/guided\.fileTooLarge/)).not.toBeInTheDocument();
  });

  it("always shows the size-limit hint so the cap is discoverable pre-upload", () => {
    setup();
    expect(screen.getByText(/guided\.fileSizeHint/)).toBeInTheDocument();
  });
});
