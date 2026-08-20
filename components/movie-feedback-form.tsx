"use client";

import { useState } from "react";
import type { MovieFeedback, WillingnessToPay } from "@/lib/movie-feedback";

const ratingLabels = [1, 2, 3, 4, 5];

export function MovieFeedbackForm({
  initialFeedback,
  slug,
}: {
  initialFeedback: MovieFeedback | null;
  slug: string;
}) {
  const [identityRating, setIdentityRating] = useState(initialFeedback?.identityRating ?? 0);
  const [movieRating, setMovieRating] = useState(initialFeedback?.movieRating ?? 0);
  const [willingnessToPay, setWillingnessToPay] = useState<WillingnessToPay | "">(
    initialFeedback?.willingnessToPay ?? "",
  );
  const [comment, setComment] = useState(initialFeedback?.comment ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(initialFeedback ? "Your feedback is saved. You can update it." : "");

  async function submitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identityRating || !movieRating || !willingnessToPay) {
      setMessage("Please answer all three questions.");
      return;
    }

    setIsSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(slug)}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityRating, movieRating, willingnessToPay, comment }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save feedback.");
      setMessage("Thank you—your feedback has been saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save feedback.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="movie-feedback-card panel">
      <p className="eyebrow-copy">Help shape PulseReel</p>
      <h3>How did your movie feel?</h3>
      <p className="body-copy">Three quick answers will help improve identity accuracy and the paid product.</p>

      <form className="movie-feedback-form" onSubmit={submitFeedback}>
        <fieldset>
          <legend>How much did the person look like you?</legend>
          <div className="rating-options">
            {ratingLabels.map((rating) => (
              <label className={identityRating === rating ? "selected" : ""} key={rating}>
                <input
                  checked={identityRating === rating}
                  name="identityRating"
                  onChange={() => setIdentityRating(rating)}
                  type="radio"
                  value={rating}
                />
                <span>{rating}</span>
              </label>
            ))}
          </div>
          <small>1 = not like me, 5 = very much like me</small>
        </fieldset>

        <fieldset>
          <legend>How would you rate the overall movie?</legend>
          <div className="rating-options">
            {ratingLabels.map((rating) => (
              <label className={movieRating === rating ? "selected" : ""} key={rating}>
                <input
                  checked={movieRating === rating}
                  name="movieRating"
                  onChange={() => setMovieRating(rating)}
                  type="radio"
                  value={rating}
                />
                <span>{rating}</span>
              </label>
            ))}
          </div>
          <small>1 = disappointing, 5 = excellent</small>
        </fieldset>

        <fieldset>
          <legend>Would you pay to create another movie?</legend>
          <div className="pay-options">
            {([
              ["yes", "Yes"],
              ["maybe", "Maybe"],
              ["no", "Not yet"],
            ] as const).map(([value, label]) => (
              <label className={willingnessToPay === value ? "selected" : ""} key={value}>
                <input
                  checked={willingnessToPay === value}
                  name="willingnessToPay"
                  onChange={() => setWillingnessToPay(value)}
                  type="radio"
                  value={value}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="feedback-comment">
          Anything you would improve? <small>Optional</small>
          <textarea
            maxLength={500}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Tell us what would make the next movie better."
            rows={4}
            value={comment}
          />
        </label>

        <div className="feedback-submit-row">
          <button className="button" disabled={isSaving} type="submit">
            {isSaving ? "Saving..." : initialFeedback ? "Update feedback" : "Send feedback"}
          </button>
          {message ? <span aria-live="polite">{message}</span> : null}
        </div>
      </form>
    </section>
  );
}
