import { useState, useEffect, useRef } from "react";
import { Globe, Heart, Trash2, Edit3, Image, X, AlertCircle, Loader, CheckCircle, WifiOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import { useTargetLanguage } from "../context/TargetLanguageContext";
import { useNetwork } from "../context/NetworkContext";
import {
  getCommunityPosts,
  createCommunityPost,
  updateCommunityPost,
  deleteCommunityPost,
  toggleLikeCommunityPost
} from "../api/communityApi";
import type { CommunityPost } from "../api/communityApi";

const LANGUAGES = ["All", "English", "German", "Spanish", "French", "Arabic"];

const LANGUAGE_FLAGS: Record<string, string> = {
  English: "🇬🇧",
  German: "🇩🇪",
  Spanish: "🇪🇸",
  French: "🇫🇷",
  Arabic: "🇸🇦"
};

export function CommunityPage() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { targetLanguage } = useTargetLanguage();
  const { isOffline } = useNetwork();

  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter State
  const [selectedLanguage, setSelectedLanguage] = useState("All");

  // Create Form State
  const [newPostText, setNewPostText] = useState("");
  const [newPostImage, setNewPostImage] = useState<File | null>(null);
  const [newPostImagePreview, setNewPostImagePreview] = useState<string | null>(null);
  const [learningLanguage, setLearningLanguage] = useState(targetLanguage);
  const [isPosting, setIsPosting] = useState(false);
  const [postSuccess, setPostSuccess] = useState(false);

  // Edit State
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Delete State
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backendBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

  // Load posts
  const fetchFeed = async () => {
    setLoading(true);
    setError(null);
    const cacheKey = `linguaai_community_feed_${selectedLanguage}`;
    try {
      const data = await getCommunityPosts({
        page: 1,
        limit: 50,
        language: selectedLanguage === "All" ? undefined : selectedLanguage
      });
      setPosts(data.items || []);
      localStorage.setItem(cacheKey, JSON.stringify(data.items || []));
    } catch (e) {
      console.error("Failed to load community feed", e);
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          setPosts(JSON.parse(cached));
        } catch {
          setError(t("could_not_load_posts"));
        }
      } else {
        setError(t("could_not_load_posts"));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, [selectedLanguage]);

  // Handle image pick
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert(t("file_too_large"));
        return;
      }
      setNewPostImage(file);
      setNewPostImagePreview(URL.createObjectURL(file));
    }
  };

  const clearImage = () => {
    setNewPostImage(null);
    setNewPostImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Submit new post
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isOffline) {
      alert("You are offline. Creating posts is disabled.");
      return;
    }
    if (!newPostText.trim() && !newPostImage) return;

    setIsPosting(true);
    setPostSuccess(false);

    try {
      const formData = new FormData();
      formData.append("learningLanguage", learningLanguage);
      if (newPostText.trim()) {
        formData.append("text", newPostText);
      }
      if (newPostImage) {
        formData.append("image", newPostImage);
      }

      await createCommunityPost(formData);
      setNewPostText("");
      clearImage();
      setPostSuccess(true);
      setTimeout(() => setPostSuccess(false), 3000);
      fetchFeed();
    } catch (e) {
      console.error("Failed to create community post", e);
      alert(t("failed_submit_post"));
    } finally {
      setIsPosting(false);
    }
  };

  // Liking post
  const handleToggleLike = async (postId: string) => {
    if (isOffline) {
      alert("You are offline. Liking posts is disabled.");
      return;
    }
    try {
      // Optimistic update
      setPosts((prev: CommunityPost[]) =>
        prev.map((post: CommunityPost) => {
          if (post._id === postId) {
            const liked = !post.likedByMe;
            return {
              ...post,
              likedByMe: liked,
              likesCount: liked ? post.likesCount + 1 : post.likesCount - 1
            };
          }
          return post;
        })
      );
      await toggleLikeCommunityPost(postId);
    } catch (e) {
      console.error("Failed to toggle like", e);
      // Revert if failed
      fetchFeed();
    }
  };

  // Editing post inline
  const startEditing = (post: CommunityPost) => {
    setEditingPostId(post._id);
    setEditingText(post.text || "");
  };

  const handleUpdatePost = async (postId: string) => {
    if (!editingText.trim()) return;
    setIsUpdating(true);
    try {
      const formData = new FormData();
      formData.append("text", editingText);
      await updateCommunityPost(postId, formData);
      setEditingPostId(null);
      fetchFeed();
    } catch (e) {
      console.error("Failed to update post", e);
      alert(t("failed_update_post"));
    } finally {
      setIsUpdating(false);
    }
  };

  // Deleting post
  const handleDeletePost = async (postId: string) => {
    try {
      await deleteCommunityPost(postId);
      setDeletingPostId(null);
      setPosts((prev: CommunityPost[]) => prev.filter((p: CommunityPost) => p._id !== postId));
    } catch (e) {
      console.error("Failed to delete post", e);
      alert(t("failed_delete_post"));
    }
  };

  const formatTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return t('just_now');
      if (diffMins < 60) return t('m_ago').replace('{num}', diffMins.toString());
      if (diffHours < 24) return t('h_ago').replace('{num}', diffHours.toString());
      if (diffDays < 7) return t('d_ago').replace('{num}', diffDays.toString());

      return d.toLocaleDateString();
    } catch {
      return "";
    }
  };

  return (
    <div className="p-6 max-w-[780px] mx-auto space-y-6 animate-fade-in" style={{ background: "var(--l-bg)", minHeight: "100vh" }}>
      {isOffline && (
        <div className="flex items-center gap-2 p-3 text-xs font-bold rounded-xl animate-fade-in shrink-0" style={{ background: "rgba(245, 158, 11, 0.12)", color: "#F59E0B", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
          <WifiOff size={14} />
          <span>{t("offline_community_feed")}</span>
        </div>
      )}
      {/* Header */}
      <div>
        <h1 style={{ color: "var(--l-text)", fontWeight: 800, fontSize: "26px", letterSpacing: "-0.02em" }}>{t("community")}</h1>
        <p style={{ fontSize: "14px", color: "var(--l-muted)", marginTop: "4px" }}>{t("share_tip_desc")}</p>
      </div>

      {/* Language Filter */}
      <div className="flex gap-2 pb-2 overflow-x-auto scrollbar-hide border-b" style={{ borderColor: "var(--l-border-subtle)" }}>
        {LANGUAGES.map((lang) => (
          <button
            key={lang}
            onClick={() => setSelectedLanguage(lang)}
            className="py-2 px-4 rounded-xl text-xs font-bold transition-all shrink-0 hover:scale-105"
            style={{
              background: selectedLanguage === lang ? "rgba(99,102,241,0.15)" : "var(--l-surface)",
              color: selectedLanguage === lang ? "#6366F1" : "var(--l-muted)",
              border: selectedLanguage === lang ? "1px solid rgba(99,102,241,0.3)" : "1px solid var(--l-border)",
              cursor: "pointer"
            }}
          >
            {lang === "All" ? t("all_languages") : `${LANGUAGE_FLAGS[lang] || ""} ${t('lang_' + lang.toLowerCase())}`}
          </button>
        ))}
      </div>

      {/* Create Post Composer Card */}
      <form
        onSubmit={handleCreatePost}
        className="premium-card p-5 space-y-4 animate-fade-in"
        style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}
      >
        <div className="flex items-start gap-4">
          {/* User initials avatar */}
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
            {user?.name ? user.name.substring(0, 2).toUpperCase() : "G"}
          </div>

          <div className="flex-1 space-y-3">
            <textarea
              value={newPostText}
              onChange={(e) => setNewPostText(e.target.value)}
              placeholder={isOffline ? "Posting is disabled offline" : t("share_placeholder")}
              rows={3}
              maxLength={1000}
              className="w-full bg-transparent resize-none outline-none border-0 p-0 text-sm focus:ring-0 text-[var(--l-text)] placeholder-[var(--l-subtle)]"
              style={{ lineHeight: 1.5 }}
              disabled={isOffline || isPosting}
            />

            {/* Image Preview inside composer if picked */}
            {newPostImagePreview && (
              <div className="relative rounded-xl overflow-hidden border max-w-md" style={{ borderColor: "var(--l-border)" }}>
                <img src={newPostImagePreview} alt="upload preview" className="w-full h-40 object-cover" />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Hidden file input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImageChange}
          accept="image/jpeg,image/jpg,image/png,image/webp"
          className="hidden"
        />

        <div className="h-px w-full" style={{ background: "var(--l-border-subtle)" }} />

        {/* Bottom Actions bar */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl transition-all hover:bg-[var(--l-card-hover)] cursor-pointer"
            style={{ color: "var(--l-muted)" }}
            disabled={isOffline}
          >
            <Image size={15} className="text-indigo-500" />
            <span>{t("add_image")}</span>
          </button>

          <div className="flex items-center gap-3">
            <span className="text-[10px] text-[var(--l-subtle)] font-medium">{newPostText.length} / 1000</span>
            <select
              value={learningLanguage}
              onChange={(e) => setLearningLanguage(e.target.value as any)}
              className="bg-transparent text-xs font-semibold py-1.5 px-3 border-0 outline-none cursor-pointer rounded-lg hover:bg-[var(--l-card-hover)]"
              style={{ color: "var(--l-muted)" }}
              disabled={isOffline}
            >
              {LANGUAGES.filter(l => l !== "All").map((lang) => (
                <option key={lang} value={lang} className="bg-[var(--l-surface)]">
                  {t('lang_' + lang.toLowerCase())}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={isOffline || isPosting || (!newPostText.trim() && !newPostImage)}
              className="btn-primary py-2 px-5 text-xs font-bold flex items-center gap-1.5 shadow-md transition-all"
              style={{ cursor: (isOffline || isPosting || (!newPostText.trim() && !newPostImage)) ? "not-allowed" : "pointer" }}
            >
              {isPosting ? (
                <>
                  <Loader size={12} className="animate-spin" />
                  {t("posting")}
                </>
              ) : (
                t("post_btn")
              )}
            </button>
          </div>
        </div>

        {postSuccess && (
          <div className="flex items-center gap-1.5 p-2.5 rounded-xl text-[11px] font-semibold animate-fade-in justify-center animate-pulse"
               style={{ background: "rgba(34, 197, 94, 0.1)", color: "#22C55E", border: "1px solid rgba(34, 197, 94, 0.2)" }}>
            <CheckCircle size={14} />
            <span>{t("posted_successfully")}</span>
          </div>
        )}
      </form>

      {/* Feed List */}
      <div className="space-y-5">
        {loading && posts.length === 0 ? (
          <div className="text-center py-20" style={{ color: "var(--l-muted)" }}>
            <Loader size={36} className="animate-spin mx-auto opacity-50 mb-3" />
            <div className="font-bold text-sm">{t("loading_posts")}</div>
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl text-center border space-y-2" style={{ background: "var(--l-surface)", borderColor: "rgba(239, 68, 68, 0.2)" }}>
            <AlertCircle size={32} className="mx-auto text-red-500" />
            <div className="font-bold text-red-500 text-sm">{error}</div>
            <button
              onClick={fetchFeed}
              className="btn-secondary py-1.5 px-4 mt-2"
            >
              {t("try_again")}
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="p-12 text-center border-2 border-dashed rounded-2xl flex flex-col items-center justify-center space-y-3 min-h-[300px]" style={{ borderColor: "var(--l-border)", color: "var(--l-muted)" }}>
            <Globe size={36} className="opacity-40" />
            <div className="font-bold text-sm">{t("no_posts_yet")}</div>
          </div>
        ) : (
          posts.map((post: CommunityPost) => {
            const isOwner = post.userId === user?.id;
            const hasLiked = post.likedByMe;
            
            // Resolve absolute image URL
            const imageUrl = post.imageUrl
              ? (post.imageUrl.startsWith("http")
                ? post.imageUrl
                : `${backendBaseUrl}${post.imageUrl}`)
              : null;

            return (
              <div
                key={post._id}
                className="p-6 rounded-2xl space-y-4 relative transition-all hover:shadow-md border"
                style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}
              >
                {/* Card Header */}
                <div className="flex items-center gap-3">
                  {/* User Initials Circle */}
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0" style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
                    {post.userName ? post.userName.substring(0, 2).toUpperCase() : "U"}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--l-text)" }}>{post.userName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--l-muted)" }}>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wider text-indigo-500"
                      >
                        {language === "en" ? `Learning ${t('lang_' + post.learningLanguage.toLowerCase())}` : `${t('lang_' + post.learningLanguage.toLowerCase())} öğreniyor`}
                      </span>
                      <span>•</span>
                      <span>{formatTime(post.createdAt)}</span>
                    </div>
                  </div>

                  {/* Owner Options */}
                  {isOwner && (
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => startEditing(post)}
                        className="p-1.5 rounded-lg hover:bg-[var(--l-card-hover)] transition-colors text-gray-400 hover:text-indigo-500 cursor-pointer"
                        title={t("edit")}
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => setDeletingPostId(post._id)}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-gray-400 hover:text-red-500 cursor-pointer"
                        title={t("delete")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Card Body */}
                <div className="space-y-3">
                  {editingPostId === post._id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="form-textarea resize-none text-sm"
                        rows={3}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingPostId(null)}
                          className="btn-secondary py-1 px-3 text-xs"
                        >
                          {t("cancel")}
                        </button>
                        <button
                          onClick={() => handleUpdatePost(post._id)}
                          disabled={isUpdating || !editingText.trim()}
                          className="btn-primary py-1 px-3 text-xs"
                        >
                          {isUpdating ? t("updating") : t("save")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p style={{ fontSize: "14px", color: "var(--l-text2)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{post.text}</p>
                  )}

                  {imageUrl && (
                    <div className="rounded-2xl overflow-hidden border max-h-[400px] w-full" style={{ borderColor: "var(--l-border-subtle)", background: "var(--l-surface2)" }}>
                      <img
                        src={imageUrl}
                        alt="post content"
                        className="w-full object-cover max-h-[400px] hover:scale-[1.01] transition-transform duration-300 cursor-zoom-in"
                        style={{ display: "block" }}
                      />
                    </div>
                  )}
                </div>

                {/* Card Footer Actions */}
                <div className="flex items-center gap-6 pt-3 border-t" style={{ borderColor: "var(--l-border-subtle)" }}>
                  <button
                    onClick={() => handleToggleLike(post._id)}
                    className="flex items-center gap-1.5 text-xs font-bold transition-all"
                    style={{ color: hasLiked ? "#EF4444" : "var(--l-muted)", cursor: "pointer" }}
                  >
                    <Heart size={16} fill={hasLiked ? "#EF4444" : "none"} strokeWidth={2} />
                    <span>{post.likesCount} {t("like")}</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deletingPostId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
          <div
            className="p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-xl"
            style={{ background: "var(--l-surface)", border: "1px solid var(--l-border)" }}
          >
            <div className="flex items-center gap-3 text-red-500">
              <AlertCircle size={24} />
              <h3 style={{ fontSize: "16px", fontWeight: 800 }}>{t("delete_post_title")}</h3>
            </div>
            <p style={{ fontSize: "13px", color: "var(--l-muted)" }}>{t("confirm_delete")}</p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setDeletingPostId(null)}
                className="btn-secondary"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => handleDeletePost(deletingPostId)}
                className="btn-danger"
              >
                {t("delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
