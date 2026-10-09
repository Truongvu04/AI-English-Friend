# Database Migrations

Thư mục này dùng để lưu các file migration theo từng phiên bản cho dự án AI English Friend.

## Cài đặt mới

Nếu cài đặt project trên một máy mới hoặc tạo database mới, không cần chạy các file migration cũ.

Chỉ cần sử dụng:

`database/schema.sql`

File này luôn đại diện cho cấu trúc database đầy đủ và mới nhất của dự án.

## Nâng cấp database hiện có

Khi các phiên bản sau của AI English Friend thay đổi cấu trúc database, một file migration mới sẽ được thêm vào thư mục này.

Ví dụ:

001_add_user_sessions.sql

002_add_account_preferences.sql

003_add_new_feature.sql

Các migration phải được chạy theo đúng thứ tự số tăng dần.

## Quy tắc sử dụng migration

1. Không chỉnh sửa một migration sau khi migration đó đã được phát hành hoặc đã được sử dụng trên database thực tế.

2. Mỗi thay đổi mới về cấu trúc database phải tạo một file migration mới.

3. Migration phải cố gắng giữ nguyên dữ liệu hiện có của người dùng.

4. Nếu migration có thao tác có khả năng làm mất dữ liệu, file migration phải ghi rõ yêu cầu backup database trước khi chạy.

5. Khi cài đặt mới, luôn sử dụng file:

`database/schema.sql`

6. Sau khi tạo một migration mới, cũng phải cập nhật:

`database/schema.sql`

để file schema tiếp tục phản ánh cấu trúc database mới nhất.

## Baseline database hiện tại

Database hiện tại của AI English Friend gồm 7 bảng chính:

1. `users`
2. `user_settings`
3. `ai_personas`
4. `user_persona_settings`
5. `conversations`
6. `messages`
7. `memories`

Các bảng Learning cũ như:

`vocabulary`

`grammar_mistakes`

`learning_progress`

đã được loại khỏi baseline hiện tại vì không còn thuộc chức năng chính của AI English Friend.

## Phiên bản baseline hiện tại

Baseline hiện tại:

`Batch 4.1.2`

Từ baseline này trở đi, mọi thay đổi mới về database nên được thực hiện thông qua migration mới trong thư mục này.