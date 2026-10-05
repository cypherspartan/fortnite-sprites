import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

function cleanFamilyName(name: string): string {
  return name
    .replace(/\s+Sprite$/i, "")
    .trim();
}

function variantName(variant: any): string {
  if (!variant) return "";

  const id = variant.id || "";

  // Epic removed this C7S3 variant.
  if (id === "PunkSprite_Variant_Gem") {
    return "";
  }

  return (
    variant.variant ||
    variant.name ||
    ""
  ).trim();
}

function buildFamilies(rawData: any) {
  const families: Record<string, any> = {};

  const sprites = Array.isArray(rawData?.sprites)
    ? rawData.sprites
    : [];

  for (const sprite of sprites) {
    const familyName = cleanFamilyName(
      sprite?.name || ""
    );

    if (!familyName) continue;

    if (!families[familyName]) {
      families[familyName] = {
        name: familyName,
        baseKnown: false,
        baseOwned: false,
        variants: [],
      };
    }

    const family = families[familyName];

    const variants = Array.isArray(sprite?.variants)
      ? sprite.variants
      : [];

    for (const variant of variants) {
      const name = variantName(variant);

      if (!name) continue;

      const isBase =
        name.toLowerCase() === "base";

      if (isBase) {
        family.baseKnown = true;
        family.baseOwned =
          variant?.owned === true;
      }

      family.variants.push({
        name,
        owned: variant?.owned === true,
        mastered:
          typeof variant?.mastered === "boolean"
            ? variant.mastered
            : null,
        image:
          variant?.images?.icon || "",
        id:
          variant?.id || "",
      });
    }
  }

  return Object.values(families);
}

function calculateStats(families: any[]) {
  let totalVariants = 0;
  let ownedVariants = 0;
  let mastered = 0;
  let masterable = 0;
  let ownedFamilies = 0;

  for (const family of families) {
    let familyOwned = false;

    for (const variant of family.variants) {
      const isBase =
        variant.name.toLowerCase() === "base";

      if (!variant.owned && isBase) {
        totalVariants++;
      }

      if (!isBase) {
        totalVariants++;
      }

      if (variant.owned) {
        ownedVariants++;
        familyOwned = true;
      }

      if (
        variant.owned &&
        variant.mastered !== null &&
        typeof variant.mastered !== "undefined"
      ) {
        masterable++;

        if (variant.mastered) {
          mastered++;
        }
      }
    }

    if (familyOwned) {
      ownedFamilies++;
    }
  }

  const totalFamilies = families.length;

  const completionPercent =
    totalVariants > 0
      ? (ownedVariants / totalVariants) * 100
      : 0;

  return {
    ownedVariants,
    totalVariants,
    ownedFamilies,
    totalFamilies,
    completionPercent,
    masteredVariantCount: mastered,
    ownedMasterableVariantCount: masterable,
  };
}

function buildSeason(rawData: any, season: any) {
  const families = buildFamilies(rawData);

  const calculatedStats = calculateStats(families);

  const stats =
    rawData?.ownedVariants !== undefined
      ? {
          ownedVariants:
            rawData.ownedVariants ?? 0,
          totalVariants:
            rawData.totalVariants ?? 0,
          ownedFamilies:
            rawData.ownedFamilies ?? 0,
          totalFamilies:
            rawData.totalFamilies ?? 0,
          completionPercent:
            rawData.completionPercent ?? 0,
          masteredVariantCount:
            calculatedStats.masteredVariantCount,
          ownedMasterableVariantCount:
            calculatedStats.ownedMasterableVariantCount,
        }
      : calculatedStats;

  // =========================================================
  // CURRENT / API FORMAT
  // =========================================================
  if (season.is_current) {
    return {
      key: season.season_key,
      chapter: Number(season.chapter || 0),
      season: Number(season.season || 0),
      name: season.name || "Unknown",
      gameVersion:
        season.game_version || "Unknown",
      dateBegin:
        season.date_begin || "",
      dateEnd:
        season.date_end || "",
      families,
      stats,
    };
  }

  // =========================================================
  // ARCHIVE / LEGACY FORMAT
  // =========================================================
  const owned: any[] = [];
  const missing: any[] = [];
  const ownedVariants: any[] = [];
  const missingVariants: any[] = [];

  const sprites = Array.isArray(rawData?.sprites)
    ? rawData.sprites
    : [];

  for (const sprite of sprites) {
    const spriteName = sprite?.name || "";
    if (!spriteName) continue;

    const variants = Array.isArray(sprite?.variants)
      ? sprite.variants
      : [];

    let hasOwnedBase = false;

    for (const variant of variants) {
      const name = variantName(variant);
      if (!name) continue;

      const record = {
        spriteName,
        variant: {
          ...variant,
        },
      };

      const isBase =
        name.toLowerCase() === "base";

      if (isBase) {
        if (variant?.owned === true) {
          hasOwnedBase = true;
          owned.push({
            name: spriteName,
          });
        } else {
          missing.push({
            name: spriteName,
          });
        }

        continue;
      }

      if (variant?.owned === true) {
        ownedVariants.push(record);
      } else {
        missingVariants.push(record);
      }
    }

    // Handle sprites that have no explicit Base variant
    if (variants.length === 0) {
      missing.push({
        name: spriteName,
      });
    }
  }

  return {
    key: season.season_key,
    chapter: Number(season.chapter || 0),
    season: Number(season.season || 0),
    name: season.name || "Unknown",
    gameVersion:
      season.game_version || "Unknown",
    dateBegin:
      season.date_begin || "",
    dateEnd:
      season.date_end || "",

    stats,

    owned,
    missing,
    ownedVariants,
    missingVariants,
  };
}

export default {
  fetch: withSupabase(
    { auth: ["publishable", "secret"] },
    async (req, ctx) => {
      try {
        const {
          data: currentSeason,
          error: currentSeasonError,
        } = await ctx.supabaseAdmin
          .from("seasons")
          .select(
            "id, season_key, chapter, season, name, game_version, date_begin, date_end, is_current"
          )
          .eq("is_current", true)
          .maybeSingle();

        if (currentSeasonError) {
          return Response.json(
            {
              error: "Failed to get current season",
              details: currentSeasonError.message,
            },
            { status: 500 }
          );
        }

        if (!currentSeason) {
          return Response.json(
            {
              error: "No current season found",
            },
            { status: 404 }
          );
        }

        const {
          data: collections,
          error: collectionsError,
        } = await ctx.supabaseAdmin
          .from("collections")
          .select(
            "season_id, generated_at, raw_data"
          );

        if (collectionsError) {
          return Response.json(
            {
              error: "Failed to get collections",
              details: collectionsError.message,
            },
            { status: 500 }
          );
        }

        const currentCollection =
          collections?.find(
            (collection) =>
              collection.season_id ===
              currentSeason.id
          );

        if (!currentCollection) {
          return Response.json(
            {
              error:
                "Current season collection not found",
              seasonId: currentSeason.id,
            },
            { status: 404 }
          );
        }

        const current =
          buildSeason(
            currentCollection.raw_data,
            currentSeason
          );

        const archiveCollections =
          (collections ?? []).filter(
            (collection) =>
              collection.season_id !==
              currentSeason.id
          );

        const archiveSeasonIds =
          archiveCollections.map(
            (collection) =>
              collection.season_id
          );

        let archiveSeasons: any[] = [];

        if (archiveSeasonIds.length > 0) {
          const {
            data,
            error,
          } = await ctx.supabaseAdmin
            .from("seasons")
            .select(
              "id, season_key, chapter, season, name, game_version, date_begin, date_end, is_current"
            )
            .in("id", archiveSeasonIds);

          if (error) {
            return Response.json(
              {
                error:
                  "Failed to get archive seasons",
                details: error.message,
              },
              { status: 500 }
            );
          }

          archiveSeasons = data ?? [];
        }

        const archives =
          archiveCollections
            .map((collection) => {
              const season =
                archiveSeasons.find(
                  (entry) =>
                    entry.id ===
                    collection.season_id
                );

              if (!season) return null;

              return buildSeason(
                collection.raw_data,
                season
              );
            })
            .filter(
              (entry) => entry !== null
            );

        return Response.json({
          success: true,
          current,
          archives,
        });
      } catch (error) {
        console.error(
          "get-sprite-data error:",
          error
        );

        return Response.json(
          {
            error: "Unexpected error",
            details:
              error instanceof Error
                ? error.message
                : String(error),
          },
          { status: 500 }
        );
      }
    }
  ),
};