# @maitask/image-metadata

Image metadata extraction from file headers for Maitask.

## Features

- Format detection (PNG, JPEG, GIF, BMP, WebP)
- Dimensions extraction (width x height)
- Color depth and type information
- File size analysis
- Basic EXIF detection (JPEG)
- No external dependencies

## Supported Formats

- **PNG**: Dimensions, bit depth, color type
- **JPEG**: Dimensions, EXIF detection
- **GIF**: Dimensions
- **BMP**: Dimensions, bit depth, color type
- **WebP**: Dimensions (VP8/VP8L)

## Usage

```bash
# From base64 encoded image
echo '{"base64":"iVBORw0KGgo..."}' | maitask run @maitask/image-metadata

# From file (engine handles base64 conversion)
maitask run @maitask/image-metadata --input image.png
```

## Output Example

```json
{
  "success": true,
  "format": "PNG",
  "fileSize": 12345,
  "dimensions": {
    "width": 1920,
    "height": 1080
  },
  "colorInfo": {
    "bitDepth": 8,
    "colorType": "RGBA"
  },
  "exif": null
}
```

## Use Cases

- Image validation and verification
- Automatic image cataloging
- Thumbnail generation planning
- Format conversion preparation
- Storage optimization analysis

## License

MIT
