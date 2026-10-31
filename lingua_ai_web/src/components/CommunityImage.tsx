import { useEffect, useState } from "react";

/** Bearer stays on the configured API origin; blob URLs are session-local. */
export function CommunityImage({
  src,
  token,
  baseUrl,
}: {
  src: string;
  token: string | null;
  baseUrl: string;
}) {
  const [image, setImage] = useState<{
    source: string;
    ownerToken: string;
    url: string;
  }>();
  useEffect(() => {
    if (!token) return;
    const url = new URL(src, baseUrl),
      base = new URL(baseUrl);
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      !/^\/uploads\/community\/[a-zA-Z0-9.-]+$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      return;
    const abort = new AbortController();
    let blobUrl: string | undefined;
    void (async () => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
        signal: abort.signal,
        cache: "no-store",
      });
      if (
        !response.ok ||
        !/^image\/(jpeg|png|webp)$/.test(
          response.headers.get("content-type")?.split(";")[0] || "",
        )
      )
        return;
      const reader = response.body?.getReader();
      if (!reader) return;
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 5 * 1024 * 1024) {
          await reader.cancel();
          return;
        }
        parts.push(value as Uint8Array<ArrayBuffer>);
      }
      if (abort.signal.aborted) return;
      blobUrl = URL.createObjectURL(
        new Blob(parts, { type: response.headers.get("content-type")! }),
      );
      setImage({ source: src, ownerToken: token, url: blobUrl });
    })().catch(() => undefined);
    return () => {
      abort.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [src, token, baseUrl]);
  return image && image.ownerToken === token && image.source === src ? (
    <img
      src={image.url}
      alt="post content"
      className="w-full object-cover max-h-[400px]"
      style={{ display: "block" }}
    />
  ) : null;
}
