import path from "node:path";

const appDir = process.env.MOVIE_MATCH_APP_DIR
  || "C:\\Users\\legionnaire\\Desktop\\study\\1 trimester\\базы данных\\ass6ver2";
const backendDir = path.join(appDir, "backend");

function target(relativePath) {
  return path.join(backendDir, ...relativePath.split(/[\\/]+/));
}

export const mutationConfig = {
  appDir,
  backendDir,
  baseUrl: process.env.MUTATION_BASE_URL || "http://127.0.0.1:4000",
  suiteName: "api:all",
};

export const mutants = [
  {
    id: "AUTH-01",
    module: "Authentication / Authorization",
    mutantType: "Logical operator change",
    file: target("src\\middleware\\auth.middleware.js"),
    description: "Invert the missing-token guard so valid bearer tokens are rejected.",
    search: 'if (!token) return res.status(401).json({ error: "Access denied. No token." });',
    replace: 'if (token) return res.status(401).json({ error: "Access denied. No token." });',
  },
  {
    id: "AUTH-02",
    module: "Authentication / Authorization",
    mutantType: "Return value modification",
    file: target("src\\controllers\\userController.js"),
    description: "Downgrade every issued JWT role to user, breaking admin-only flows.",
    search: '{ id: user._id, username: user.username, role: user.role },',
    replace: '{ id: user._id, username: user.username, role: "user" },',
  },
  {
    id: "SYNC-01",
    module: "Profile / Like Sync",
    mutantType: "Logical operator change",
    file: target("src\\controllers\\userController.js"),
    description: "Invert duplicate-like detection so first-time likes are blocked.",
    search: 'if (user.likedMovies.includes(movieId)) {',
    replace: 'if (!user.likedMovies.includes(movieId)) {',
  },
  {
    id: "SYNC-02",
    module: "Profile / Like Sync",
    mutantType: "Constant alteration",
    file: target("src\\controllers\\userController.js"),
    description: "Log likes with the wrong interaction type so sync validation cannot find them.",
    search: "await Interaction.create({ userId, movieId, type: 'like' });",
    replace: "await Interaction.create({ userId, movieId, type: 'view' });",
  },
  {
    id: "SYNC-03",
    module: "Profile / Like Sync",
    mutantType: "Logical operator change",
    file: target("src\\controllers\\userController.js"),
    description: "Break unlike cleanup by keeping only the selected movie in likedMovies.",
    search: "user.likedMovies = user.likedMovies.filter(id => id.toString() !== movieId);",
    replace: "user.likedMovies = user.likedMovies.filter(id => id.toString() === movieId);",
  },
  {
    id: "PROFILE-01",
    module: "Profile / Like Sync",
    mutantType: "Return value modification",
    file: target("src\\controllers\\userController.js"),
    description: "Drop bannerUrl from profile payload while keeping the rest of the response intact.",
    search: "        bannerUrl: movie.bannerUrl,",
    replace: "        bannerUrl: null,",
  },
  {
    id: "MOVIES-01",
    module: "Movie Catalog / Admin CRUD",
    mutantType: "Function removal",
    file: target("src\\controllers\\movieController.js"),
    description: "Remove the MongoDB catalog fetch and return an empty list.",
    search: "    const movies = await Movie.find();",
    replace: "    const movies = [];",
  },
  {
    id: "MOVIES-02",
    module: "Movie Catalog / Admin CRUD",
    mutantType: "Return value modification",
    file: target("src\\controllers\\movieController.js"),
    description: "Change createMovie success status from 201 to 200.",
    search: "    res.status(201).json(movie);",
    replace: "    res.status(200).json(movie);",
  },
  {
    id: "MOVIES-03",
    module: "Movie Catalog / Admin CRUD",
    mutantType: "Return value modification",
    file: target("src\\controllers\\movieController.js"),
    description: "Change the update success message so API assertions no longer match.",
    search: '    res.json({ message: "Movie updated successfully", movie });',
    replace: '    res.json({ message: "Movie updated", movie });',
  },
  {
    id: "MOVIES-04",
    module: "Movie Catalog / Admin CRUD",
    mutantType: "Return value modification",
    file: target("src\\controllers\\movieController.js"),
    description: "Return a null deletedId even though the movie was removed.",
    search: '    res.json({ message: "Movie deleted successfully", deletedId: id });',
    replace: '    res.json({ message: "Movie deleted successfully", deletedId: null });',
  },
  {
    id: "RECO-01",
    module: "Recommendation Engine",
    mutantType: "Constant alteration",
    file: target("src\\controllers\\recommendController.js"),
    description: "Limit recommendation output to a single result instead of the top 10.",
    search: "      }).sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 10);",
    replace: "      }).sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 1);",
  },
  {
    id: "RECO-02",
    module: "Recommendation Engine",
    mutantType: "Constant alteration",
    file: target("src\\controllers\\recommendController.js"),
    description: "Swap hybrid recommendation weights from 60/40 to 40/60.",
    search: "        const hybridScore = (content.contentScore * 0.6) + (collab.collabScore * 0.4);",
    replace: "        const hybridScore = (content.contentScore * 0.4) + (collab.collabScore * 0.6);",
  },
];
