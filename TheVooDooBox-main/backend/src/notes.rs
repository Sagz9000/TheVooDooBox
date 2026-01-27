use actix_web::{get, post, web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;
use chrono::Utc;

// --- NOTES ---

#[derive(Serialize, Deserialize, sqlx::FromRow)]
pub struct Note {
    pub id: String,
    pub task_id: String,
    pub author: String,
    pub content: String,
    pub is_hint: bool,
    pub created_at: i64,
}

#[derive(Deserialize)]
pub struct CreateNoteRequest {
    pub task_id: String,
    pub content: String,
    pub is_hint: bool,
}

#[post("/notes")]
pub async fn add_note(
    pool: web::Data<PgPool>,
    req: web::Json<CreateNoteRequest>
) -> impl Responder {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    
    let result = sqlx::query(
        "INSERT INTO analyst_notes (id, task_id, author, content, is_hint, created_at) VALUES ($1, $2, $3, $4, $5, $6)"
    )
    .bind(&id)
    .bind(&req.task_id)
    .bind("analyst")
    .bind(&req.content)
    .bind(req.is_hint)
    .bind(now)
    .execute(pool.get_ref())
    .await;

    match result {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({"status": "created", "id": id})),
        Err(e) => HttpResponse::InternalServerError().body(format!("Error: {}", e))
    }
}

#[get("/tasks/{task_id}/notes")]
pub async fn get_notes(
    pool: web::Data<PgPool>,
    path: web::Path<String>
) -> impl Responder {
    let task_id = path.into_inner();
    let notes = sqlx::query_as::<_, Note>(
        "SELECT * FROM analyst_notes WHERE task_id = $1 ORDER BY created_at DESC"
    )
    .bind(task_id)
    .fetch_all(pool.get_ref())
    .await;

    match notes {
        Ok(notes) => HttpResponse::Ok().json(notes),
        Err(e) => HttpResponse::InternalServerError().body(format!("Error: {}", e))
    }
}

// --- TAGS ---

#[derive(Serialize, Deserialize, sqlx::FromRow)]
pub struct Tag {
    pub task_id: String,
    pub event_id: i32,
    pub tag_type: String,
    pub comment: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateTagRequest {
    pub task_id: String,
    pub event_id: i32,
    pub tag_type: String,
    pub comment: Option<String>,
}

#[post("/tags")]
pub async fn add_tag(
    pool: web::Data<PgPool>,
    req: web::Json<CreateTagRequest>
) -> impl Responder {
    let result = sqlx::query(
        "INSERT INTO telemetry_tags (task_id, event_id, tag_type, comment) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (task_id, event_id) 
         DO UPDATE SET tag_type = EXCLUDED.tag_type, comment = EXCLUDED.comment"
    )
    .bind(&req.task_id)
    .bind(req.event_id)
    .bind(&req.tag_type)
    .bind(&req.comment)
    .execute(pool.get_ref())
    .await;

    match result {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({"status": "tagged"})),
        Err(e) => HttpResponse::InternalServerError().body(format!("Error: {}", e))
    }
}

#[get("/tasks/{task_id}/tags")]
pub async fn get_tags(
    pool: web::Data<PgPool>,
    path: web::Path<String>
) -> impl Responder {
    let task_id = path.into_inner();
    let tags = sqlx::query_as::<_, Tag>(
        "SELECT * FROM telemetry_tags WHERE task_id = $1"
    )
    .bind(task_id)
    .fetch_all(pool.get_ref())
    .await;

    match tags {
        Ok(tags) => HttpResponse::Ok().json(tags),
        Err(e) => HttpResponse::InternalServerError().body(format!("Error: {}", e))
    }
}
