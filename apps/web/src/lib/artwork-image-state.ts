const failedUrls = new Set<string>();

export function artworkImageFailed(url: string) { return failedUrls.has(url); }
export function rememberArtworkImageFailure(url: string) {
  if (failedUrls.size >= 200) failedUrls.delete(failedUrls.values().next().value!);
  failedUrls.add(url);
}
