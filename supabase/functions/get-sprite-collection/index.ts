import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const REFRESH_TOKEN_URL =
  "https://prod.api-fortnite.com/api/v1/oauth/refresh-token";

const COLLECTION_URL =
  "https://prod.api-fortnite.com/api/v2/sprites/collection";

export default {
  fetch: withSupabase(
    { auth: ["publishable", "secret"] },
    async (req, ctx) => {
      try {
        const apiKey = Deno.env.get("FORTNITE_API_KEY");
        const refreshToken = Deno.env.get("FORTNITE_REFRESH_TOKEN");

        if (!apiKey) {
          return Response.json(
            { error: "FORTNITE_API_KEY secret is missing" },
            { status: 500 }
          );
        }

        if (!refreshToken) {
          return Response.json(
            { error: "FORTNITE_REFRESH_TOKEN secret is missing" },
            { status: 500 }
          );
        }

        // ============================================================
        // 1. REFRESH FORTNITE ACCESS TOKEN
        // ============================================================

        const refreshResponse = await fetch(REFRESH_TOKEN_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            refreshToken: refreshToken,
          }),
        });

        const refreshBody = await refreshResponse.text();

        if (!refreshResponse.ok) {
          console.error(
            `Fortnite token refresh failed: ${refreshResponse.status} ${refreshResponse.statusText}`
          );

          return Response.json(
            {
              error: "Fortnite token refresh failed",
              status: refreshResponse.status,
            },
            { status: 502 }
          );
        }

        const tokenData = JSON.parse(refreshBody);

        const accessToken = tokenData.accessToken;

        if (!accessToken) {
          return Response.json(
            {
              error: "Fortnite refresh response did not contain accessToken",
            },
            { status: 502 }
          );
        }

        // ============================================================
        // 2. GET SPRITE COLLECTION
        // ============================================================

        const collectionResponse = await fetch(COLLECTION_URL, {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
            "x-fortnite-token": accessToken,
          },
        });

        const collectionBody = await collectionResponse.text();

        if (!collectionResponse.ok) {
          console.error(
            `Fortnite sprite collection request failed: ${collectionResponse.status} ${collectionResponse.statusText}`
          );

          return Response.json(
            {
              error: "Fortnite sprite collection request failed",
              status: collectionResponse.status,
            },
            { status: 502 }
          );
        }

        const collectionData = JSON.parse(collectionBody);

		// TEMP: inspect Sprite catalog versions
const versionsResponse = await fetch(
  "https://prod.api-fortnite.com/api/v2/sprites/versions",
  {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  }
);

const versionsBody = await versionsResponse.text();

if (!versionsResponse.ok) {
  return Response.json(
    {
      error: "Sprite versions request failed",
      status: versionsResponse.status,
    },
    { status: 502 }
  );
}

const versionsData = JSON.parse(versionsBody);

// TEMP: inspect current Fortnite season
const seasonResponse = await fetch(
  "https://prod.api-fortnite.com/api/v1/season",
  {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  }
);

const seasonBody = await seasonResponse.text();

if (!seasonResponse.ok) {
  return Response.json(
    {
      error: "Fortnite season request failed",
      status: seasonResponse.status,
    },
    { status: 502 }
  );
}

const seasonData = JSON.parse(seasonBody);


const seasonNumber = seasonData.seasonNumber;
const seasonDateBegin = seasonData.seasonDateBegin;
const seasonDateEnd = seasonData.seasonDateEnd;

if (seasonNumber == null) {
  return Response.json(
    {
      error: "Fortnite season response did not contain seasonNumber",
      seasonData,
    },
    { status: 502 }
  );
}


const { data: existingSeason, error: seasonLookupError } =
  await ctx.supabaseAdmin
    .from("seasons")
    .select("id, season_number, season_key, chapter, season, name")
    .eq("season_number", seasonNumber)
    .maybeSingle();

if (seasonLookupError) {
  return Response.json(
    {
      error: "Failed to check season",
      details: seasonLookupError.message,
    },
    { status: 500 }
  );
}

const seasonExists = existingSeason !== null;
const newSeasonDetected = !seasonExists;

let seasonId: number;

if (newSeasonDetected) {

  // Get metadata for the new season BEFORE changing the current season
  const { data: seasonMetadata, error: metadataError } =
    await ctx.supabaseAdmin
      .from("season_metadata")
      .select("season_key, chapter, season, name")
      .eq("season_number", seasonNumber)
      .maybeSingle();

  if (metadataError) {
    return Response.json(
      {
        error: "Failed to get season metadata",
        details: metadataError.message,
      },
      { status: 500 }
    );
  }

  if (!seasonMetadata) {
    return Response.json(
      {
        error: "Season metadata not found",
        seasonNumber,
      },
      { status: 500 }
    );
  }

  // Archive the existing current season
  const { data: currentSeason, error: currentSeasonError } =
    await ctx.supabaseAdmin
      .from("seasons")
      .select("id, season_number, season_key")
      .eq("is_current", true)
      .maybeSingle();

  if (currentSeasonError) {
    return Response.json(
      {
        error: "Failed to find current season",
        details: currentSeasonError.message,
      },
      { status: 500 }
    );
  }

  if (currentSeason) {
    const { error: archiveSeasonError } =
      await ctx.supabaseAdmin
        .from("seasons")
        .update({
          is_current: false,
        })
        .eq("id", currentSeason.id);

    if (archiveSeasonError) {
      return Response.json(
        {
          error: "Failed to archive current season",
          details: archiveSeasonError.message,
        },
        { status: 500 }
      );
    }
  }

  // Create the new current season
  const { data: newSeason, error: createSeasonError } =
    await ctx.supabaseAdmin
      .from("seasons")
      .insert({
        season_number: seasonNumber,
        season_key: seasonMetadata.season_key,
        chapter: seasonMetadata.chapter,
        season: seasonMetadata.season,
        name: seasonMetadata.name,
        game_version: collectionData.data.gameVersion,
        date_begin: seasonDateBegin,
        date_end: seasonDateEnd,
        is_current: true,
      })
      .select("id")
      .single();

  if (createSeasonError) {
    return Response.json(
      {
        error: "Failed to create season",
        details: createSeasonError.message,
      },
      { status: 500 }
    );
  }

  seasonId = newSeason.id;

} else {
  seasonId = existingSeason.id;

  // Update game version/date range when Fortnite updates
  const { error: seasonUpdateError } =
    await ctx.supabaseAdmin
      .from("seasons")
      .update({
        game_version: collectionData.data.gameVersion,
        date_begin: seasonDateBegin,
        date_end: seasonDateEnd,
      })
      .eq("id", seasonId);

  if (seasonUpdateError) {
    return Response.json(
      {
        error: "Failed to update existing season",
        details: seasonUpdateError.message,
      },
      { status: 500 }
    );
  }
}


// Save current sprite collection
const { error: collectionError } = await ctx.supabaseAdmin
  .from("collections")
  .upsert(
    {
      season_id: seasonId,
      generated_at: collectionData.data.generated,
      raw_data: collectionData.data,
    },
    {
      onConflict: "season_id",
    }
  );

if (collectionError) {
  console.error("Failed to save sprite collection:", collectionError);

  return Response.json(
    {
      error: "Failed to save sprite collection",
      details: collectionError.message,
    },
    { status: 500 }
  );
}

// Save API snapshot
const { error: snapshotError } = await ctx.supabaseAdmin
  .from("api_snapshots")
  .insert({
    game_version: collectionData.data.gameVersion,
    generated_at: collectionData.data.generated,
    snapshot: collectionData.data,
  });

if (snapshotError) {
  console.error("Failed to save API snapshot:", snapshotError);

  return Response.json(
    {
      error: "Failed to save API snapshot",
      details: snapshotError.message,
    },
    { status: 500 }
  );
}

return Response.json({
  success: true,
  databaseConnected: true,
  collection: collectionData,
  versions: versionsData,
  season: seasonData,
  seasonNumber,
  seasonDateBegin,
  seasonDateEnd,
  seasonExists,
  newSeasonDetected,
  existingSeason,
});
      } catch (error) {
        console.error("Unexpected error:", error);

        return Response.json(
          { error: "Internal server error" },
          { status: 500 }
        );
      }
    }
  ),
};