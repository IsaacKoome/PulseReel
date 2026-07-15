import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from worker import (
    build_replicate_input,
    canonical_upload_name,
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

    def test_minimax_input_uses_scene_reference_only_as_first_frame(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            reference_path = Path(temporary_dir) / "scene.png"
            reference_path.write_bytes(b"scene-image")

            request_input = build_replicate_input(
                self.payload,
                {0: reference_path},
                None,
                None,
                model="minimax/video-01",
            )

        self.assertTrue(request_input["first_frame_image"].startswith("data:image/png;base64,"))
        self.assertNotIn("subject_reference", request_input)

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

    def test_source_uploads_receive_discoverable_canonical_names(self) -> None:
        upload = SimpleNamespace(filename="creator-clip.WEBM")
        self.assertEqual(canonical_upload_name("source-video", upload, ".webm"), "source-video.webm")


if __name__ == "__main__":
    unittest.main()
