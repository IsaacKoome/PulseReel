import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from worker import (
    build_replicate_input,
    canonical_upload_name,
    identity_frame_rank,
    replicate_model_for_payload,
    selected_render_provider,
)


class ReplicateRoutingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.payload = {
            "provider": "replicate-video-adapter",
            "modelHints": {
                "preferredMotionBackend": "open-source-local",
            },
            "story": {"scenePrompt": "A creator explores a cinematic city."},
            "shots": [{"prompt": "The creator enters the city."}],
            "outputSpec": {"width": 720, "height": 1280, "totalDurationSeconds": 60},
        }

    def test_payload_provider_selects_replicate_without_external_metadata(self) -> None:
        self.assertEqual(selected_render_provider(self.payload), "replicate")

    def test_kling_profile_selects_replicate_without_external_metadata(self) -> None:
        payload = {**self.payload, "provider": "replicate-kling-v3-omni"}
        self.assertEqual(selected_render_provider(payload), "replicate")

    def test_seedance_15_profile_selects_replicate_without_external_metadata(self) -> None:
        payload = {**self.payload, "provider": "replicate-seedance-1.5-pro"}
        self.assertEqual(selected_render_provider(payload), "replicate")

    def test_forwarded_model_is_used_when_payload_has_no_model_metadata(self) -> None:
        self.assertEqual(
            replicate_model_for_payload(self.payload, "minimax/video-01"),
            "minimax/video-01",
        )

    def test_minimax_input_uses_identity_as_subject_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            identity_path = Path(temporary_dir) / "identity.png"
            identity_path.write_bytes(b"identity-image")

            request_input = build_replicate_input(
                self.payload,
                {},
                identity_path,
                None,
                model="minimax/video-01",
            )

        self.assertTrue(request_input["subject_reference"].startswith("data:image/png;base64,"))
        self.assertNotIn("first_frame_image", request_input)

    def test_minimax_rejects_scene_reference_as_creator_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            reference_path = Path(temporary_dir) / "scene.png"
            reference_path.write_bytes(b"scene-image")

            with self.assertRaisesRegex(RuntimeError, "no usable creator frame"):
                build_replicate_input(
                    self.payload,
                    {0: reference_path},
                    None,
                    None,
                    model="minimax/video-01",
                )

    def test_minimax_template_cannot_send_both_image_modes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            identity_path = Path(temporary_dir) / "identity.png"
            identity_path.write_bytes(b"identity-image")

            request_input = build_replicate_input(
                self.payload,
                {},
                identity_path,
                None,
                input_template=(
                    '{"subject_reference":"{{IDENTITY_IMAGE}}",'
                    '"first_frame_image":"{{SOURCE_IMAGE_URL}}"}'
                ),
                model="minimax/video-01",
            )

        self.assertIn("subject_reference", request_input)
        self.assertNotIn("first_frame_image", request_input)

    def test_kling_input_requests_identity_audio_and_fifteen_seconds(self) -> None:
        payload = {
            **self.payload,
            "provider": "replicate-kling-v3-omni",
            "shots": [
                {"prompt": "The creator enters a harbor."},
                {"prompt": "The creator meets fishermen."},
                {"prompt": "The creator boards a ship."},
                {"prompt": "The creator faces the horizon."},
            ],
            "styleBible": {"scoreMood": "an adventurous orchestral score"},
        }
        with tempfile.TemporaryDirectory() as temporary_dir:
            identity_path = Path(temporary_dir) / "identity.png"
            identity_path.write_bytes(b"identity-image")
            with patch.dict(
                os.environ,
                {"PULSEREEL_KLING_DURATION_SECONDS": "15", "PULSEREEL_KLING_MODE": "standard"},
            ):
                request_input = build_replicate_input(
                    payload,
                    {},
                    identity_path,
                    None,
                    model="kwaivgi/kling-v3-omni-video",
                )

        self.assertEqual(request_input["duration"], 15)
        self.assertEqual(request_input["aspect_ratio"], "9:16")
        self.assertEqual(request_input["mode"], "standard")
        self.assertTrue(request_input["generate_audio"])
        self.assertEqual(len(request_input["reference_images"]), 1)
        self.assertIn("<<<image_1>>>", request_input["prompt"])
        shots = json.loads(request_input["multi_prompt"])
        self.assertEqual(len(shots), 3)
        self.assertEqual(sum(shot["duration"] for shot in shots), 15)
        self.assertTrue(all("<<<image_1>>>" in shot["prompt"] for shot in shots))

    def test_seedance_15_input_is_fixed_to_low_cost_native_audio_profile(self) -> None:
        payload = {
            **self.payload,
            "provider": "replicate-seedance-1.5-pro",
            "story": {"scenePrompt": "A creator explores a cinematic city.", "cameraMode": "cinematic"},
        }
        with tempfile.TemporaryDirectory() as temporary_dir:
            identity_path = Path(temporary_dir) / "identity.png"
            identity_path.write_bytes(b"identity-image")
            request_input = build_replicate_input(
                payload,
                {},
                identity_path,
                None,
                model="bytedance/seedance-1.5-pro",
            )

        self.assertEqual(request_input["duration"], 5)
        self.assertEqual(request_input["resolution"], "720p")
        self.assertEqual(request_input["aspect_ratio"], "9:16")
        self.assertEqual(request_input["fps"], 24)
        self.assertTrue(request_input["generate_audio"])
        self.assertTrue(request_input["image"].startswith("data:image/png;base64,"))
        self.assertNotIn("subject_reference", request_input)
        self.assertIn("not a selfie", request_input["prompt"].lower())
        self.assertIn("one coherent shot", request_input["prompt"].lower())
        self.assertIn("identity lock", request_input["prompt"].lower())

    def test_seedance_uses_a_real_source_video_frame_ahead_of_optional_selfie(self) -> None:
        payload = {
            **self.payload,
            "provider": "replicate-seedance-1.5-pro",
            "story": {"scenePrompt": "A creator explores a cinematic city.", "cameraMode": "cinematic"},
        }
        with tempfile.TemporaryDirectory() as temporary_dir:
            identity_path = Path(temporary_dir) / "identity.png"
            source_frame_path = Path(temporary_dir) / "source-frame.jpg"
            identity_path.write_bytes(b"optional-selfie")
            source_frame_path.write_bytes(b"real-video-frame")
            request_input = build_replicate_input(
                payload,
                {},
                identity_path,
                None,
                model="bytedance/seedance-1.5-pro",
                source_frame_image=source_frame_path,
            )

        self.assertTrue(request_input["image"].startswith("data:image/jpeg;base64,"))
        self.assertNotIn("b3B0aW9uYWwtc2VsZmll", request_input["image"])

    def test_seedance_15_selfie_mode_is_explicit(self) -> None:
        payload = {
            **self.payload,
            "provider": "replicate-seedance-1.5-pro",
            "story": {"scenePrompt": "A creator explores a cinematic city.", "cameraMode": "selfie"},
        }
        with tempfile.TemporaryDirectory() as temporary_dir:
            identity_path = Path(temporary_dir) / "identity.png"
            identity_path.write_bytes(b"identity-image")
            request_input = build_replicate_input(
                payload,
                {},
                identity_path,
                None,
                model="bytedance/seedance-1.5-pro",
            )

        self.assertIn("front-facing handheld selfie viewpoint", request_input["prompt"].lower())
        self.assertIn("without showing a phone or selfie stick", request_input["prompt"].lower())

    def test_seedance_rejects_prompt_only_generation_before_billing(self) -> None:
        payload = {
            **self.payload,
            "provider": "replicate-seedance-1.5-pro",
            "story": {"scenePrompt": "A creator explores a cinematic city.", "cameraMode": "selfie"},
        }

        with self.assertRaisesRegex(RuntimeError, "no usable creator frame"):
            build_replicate_input(
                payload,
                {},
                None,
                None,
                model="bytedance/seedance-1.5-pro",
            )

    def test_identity_frame_rank_penalizes_blur_and_bad_exposure(self) -> None:
        clear_well_lit = identity_frame_rank(4.0, 130.0)
        blurry = identity_frame_rank(8.0, 130.0)
        too_dark = identity_frame_rank(4.0, 20.0)
        self.assertLess(clear_well_lit, blurry)
        self.assertLess(clear_well_lit, too_dark)

    def test_source_uploads_receive_discoverable_canonical_names(self) -> None:
        upload = SimpleNamespace(filename="creator-clip.WEBM")
        self.assertEqual(canonical_upload_name("source-video", upload, ".webm"), "source-video.webm")


if __name__ == "__main__":
    unittest.main()
