from fastapi import FastAPI, UploadFile, File, Form
from faster_whisper import WhisperModel   
import tempfile
import os

# Initialize the FastAPI web framework instance
app = FastAPI()

# Load OpenAI's Whisper Speech-to-Text model locally.
# - Model Size: "base" (balance between speed and accuracy).
# - Device: "cpu" (standard processor execution).
# - Compute Type: "int8" (8-bit quantization reduces memory use and speeds up CPU calculations).
model = WhisperModel("base", device="cpu", compute_type="int8")


@app.get("/")
def health_check():
    """
    Health Check Endpoint:
    Allows the NestJS backend and monitoring tools to check if the pronunciation service is active.
    """
    return {"status": "Pronunciation service is running"}


@app.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),  # Accepts the recorded audio file upload
    language: str = Form("en")      # Target transcription language (defaults to English)
):
    """
    Speech-to-Text Transcription Endpoint:
    1. Receives audio file as multipart form-data.
    2. Writes the file to a secure, temporary path.
    3. Runs Whisper local transcription.
    4. Combines text segments and returns transcription statistics.
    5. Cleans up the temporary audio file to prevent disk capacity leaks.
    """
    temp_path = None

    try:
        # Extract the uploaded file's extension (e.g., .wav, .mp3), fallback to .wav
        suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"

        # Create a secure temporary file on the filesystem to write the uploaded audio bytes
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_path = temp_file.name
            # Write the raw bytes read asynchronously from the upload stream
            temp_file.write(await audio.read())

        # Perform local speech-to-text inference on the temporary audio file
        # - beam_size=5: Uses beam search width of 5 for higher transcription accuracy
        segments, info = model.transcribe(
            temp_path,
            language=language,
            beam_size=5
        )

        # Iterate through the transcribed audio segments and join them into a single string
        recognized_text = " ".join(segment.text.strip() for segment in segments).strip()

        # Return the final transcribed text, detected language, and confidence score
        return {
            "recognizedText": recognized_text,
            "detectedLanguage": info.language,
            "languageProbability": info.language_probability
        }

    finally:
        # Guaranteed cleanup block: ensure the temporary audio file is deleted from disk
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)