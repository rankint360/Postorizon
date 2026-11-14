# Postorizon NodeJS SDK

This is the NodeJS SDK for [Postorizon](https://postiz.com).

You can start by installing the package:

```bash
npm install @postiz/node
```

## Usage
```typescript
import Postorizon from '@postiz/node';
const postiz = new Postorizon('your api key', 'your self-hosted instance (optional)');
```

The available methods are:
- `post(posts: CreatePostDto)` - Schedule a post to Postorizon
- `postList(filters: GetPostsDto)` - Get a list of posts
- `upload(file: Buffer, extension: string)` - Upload a file to Postorizon
- `integrations()` - Get a list of connected channels
- `deletePost(id: string)` - Delete a post by ID

Alternatively you can use the SDK with curl, check the [Postorizon API documentation](https://docs.postorizon.com/public-api) for more information.